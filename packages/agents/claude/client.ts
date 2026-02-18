import { spawn, type ChildProcess } from "child_process";
import {
  getThreadSessionId,
  setThreadSessionId,
} from "@/config/local/settings";
import { log } from "@/utils";
import { buildPromptParts, buildPromptText, buildSystemPrompt } from "../shared";
import {
  CliAgentRuntime,
  normalizeSessionEnvironment,
  noopStartServer,
  type SessionEnvironment as RuntimeSessionEnvironment,
} from "../runtime/base";
import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "../types";

export type SessionEnvironment = RuntimeSessionEnvironment;

const runtime = new CliAgentRuntime("Claude");
const newSessions = new Set<string>();
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ClaudeJsonRecord = {
  type?: string;
  event?: {
    type?: string;
    index?: number;
    content_block?: Record<string, unknown>;
    delta?: Record<string, unknown>;
  };
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  result?: string;
  is_error?: boolean;
  error?: string;
  session_id?: string;
};

function deriveSessionTitleFromPrompt(message: string): string | undefined {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 80).trim()}...`;
}

function isValidUuid(value: string): boolean {
  return uuidRegex.test(value);
}

export async function createSession(workingPath: string, env?: SessionEnvironment): Promise<string> {
  const sessionId = crypto.randomUUID();
  runtime.setSessionEnvironment(sessionId, env ?? {});
  newSessions.add(sessionId);
  log.info("Created Claude session", { sessionId, workingPath });
  return sessionId;
}

export async function getOrCreateSession(
  channelId: string,
  threadId: string,
  workingPath: string,
  env: SessionEnvironment = {}
): Promise<OpenCodeSessionInfo> {
  const existingSession = getThreadSessionId(channelId, threadId, "claudecode");
  if (existingSession) {
    if (!isValidUuid(existingSession)) {
      log.info("Invalid Claude session id found; generating new session", {
        channelId,
        threadId,
        workingPath,
        existingSession,
      });
      const sessionId = await createSession(workingPath, env);
      setThreadSessionId(channelId, threadId, sessionId);
      return { sessionId, created: true };
    }

    const existingEnv = normalizeSessionEnvironment(runtime.getSessionEnvironment(existingSession));
    const desiredEnv = normalizeSessionEnvironment(env);
    if (existingEnv !== desiredEnv) {
      log.info("Claude session environment changed; creating new session", {
        channelId,
        threadId,
        workingPath,
      });
      const sessionId = await createSession(workingPath, env);
      setThreadSessionId(channelId, threadId, sessionId);
      return { sessionId, created: true };
    }

    runtime.setSessionEnvironment(existingSession, env);

    return { sessionId: existingSession, created: false };
  }

  log.info("Creating new Claude session for thread", { channelId, threadId, workingPath });
  const sessionId = await createSession(workingPath, env);
  setThreadSessionId(channelId, threadId, sessionId);
  return { sessionId, created: true };
}

function extractJsonPayload(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return trimmed;

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith("{") && line.endsWith("}")) {
      return line;
    }
  }

  const start = trimmed.lastIndexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1).trim();
  }

  return trimmed;
}

function formatClaudeCommand(args: string[]): string {
  return args
    .map((arg) => {
      if (arg.length === 0) return "''";
      if (/[^\w@%+=:,./-]/.test(arg)) {
        const escaped = arg.replace(/'/g, `"'"'"`);
        return `'${escaped}'`;
      }
      return arg;
    })
    .join(" ");
}

export function buildClaudeCommandArgs(params: {
  sessionId: string;
  isNewSession: boolean;
  systemPrompt: string;
  workingPath: string;
  prompt: string;
}): string[] {
  const sessionArgs = params.isNewSession
    ? ["--session-id", params.sessionId]
    : ["--resume", params.sessionId];
  return [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--append-system-prompt",
    params.systemPrompt,
    ...sessionArgs,
    "--add-dir",
    params.workingPath,
    params.prompt,
  ];
}

export function buildClaudeCommand(
  baseArgs: string[],
  permissionMode: string
): { args: string[]; command: string } {
  const args = [...baseArgs];
  const prompt = args.pop();
  if (prompt !== undefined) {
    args.push("--permission-mode", permissionMode, "--", prompt);
  } else {
    args.push("--permission-mode", permissionMode);
  }
  const command = formatClaudeCommand(["claude", ...args]);
  return { args, command };
}

function resolveClaudePermissionMode(agent?: string): string | undefined {
  if (agent?.trim().toLowerCase() === "plan") {
    return "plan";
  }
  return undefined;
}

function getRecordSessionId(record: ClaudeJsonRecord, fallbackSessionId: string): string {
  return typeof record.session_id === "string" ? record.session_id : fallbackSessionId;
}

function publishClaudeRecordAsSessionEvents(
  record: ClaudeJsonRecord,
  fallbackSessionId: string
): void {
  const sessionId = getRecordSessionId(record, fallbackSessionId);
  const rawType = typeof record.type === "string" && record.type.trim()
    ? record.type.trim()
    : "unknown";
  runtime.publishSessionEvent(sessionId, {
    type: `claude.raw.${rawType}`,
    properties: {
      record,
      recordType: rawType,
      streamEventType: typeof record.event?.type === "string" ? record.event.type : undefined,
    },
  });
}

function parseClaudeResult(output: string): {
  result?: string;
  is_error?: boolean;
  error?: string;
  session_id?: string;
} {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as ClaudeJsonRecord;
      if (parsed.type === "result") {
        return {
          result: parsed.result,
          is_error: parsed.is_error,
          error: parsed.error,
          session_id: parsed.session_id,
        };
      }
    } catch {
      // ignore non-json lines
    }
  }

  const payload = extractJsonPayload(output);
  return JSON.parse(payload) as {
    result?: string;
    is_error?: boolean;
    error?: string;
    session_id?: string;
  };
}

async function runClaudeCommand(
  args: string[],
  cwd: string,
  env: SessionEnvironment,
  entry: { controller: AbortController; process?: ChildProcess },
  onRecord?: (record: ClaudeJsonRecord) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd,
      env: { ...process.env, ...env },
      signal: entry.controller.signal,
    });

    entry.process = child;
    child.stdin?.end();

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBuffer = "";

    const flushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed || !onRecord) return;
      try {
        const record = JSON.parse(trimmed) as ClaudeJsonRecord;
        onRecord(record);
      } catch {
        // ignore non-json stream lines
      }
    };

    child.stdout?.on("data", (chunk) => {
      const bufferChunk = Buffer.from(chunk);
      stdoutChunks.push(bufferChunk);
      stdoutBuffer += bufferChunk.toString("utf-8");
      while (true) {
        const newlineIndex = stdoutBuffer.indexOf("\n");
        if (newlineIndex < 0) break;
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        flushLine(line);
      }
    });
    child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude CLI timed out"));
    }, 5 * 60 * 1000);

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("spawn", () => {
      log.info("Claude CLI spawned", { pid: child.pid });
    });

    child.on("exit", (code, signal) => {
      log.info("Claude CLI exited", { code, signal });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (stdoutBuffer.trim().length > 0) {
        flushLine(stdoutBuffer);
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

      log.info("Claude CLI completed", {
        code,
        stdout,
        stderr,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      if (code !== 0) {
        reject(new Error(stderr || `Claude CLI exited with code ${code}`));
        return;
      }

      if (stderr) {
        log.warn("Claude CLI stderr", { stderr });
      }

      resolve(stdout);
    });
  });
}

async function runClaudeWithFallback(
  baseArgs: string[],
  cwd: string,
  env: SessionEnvironment,
  entry: { controller: AbortController; process?: ChildProcess },
  forcedPermissionMode?: string,
  onRecord?: (record: ClaudeJsonRecord) => void
): Promise<{ output: string; permissionMode: string; command: string }> {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const modes = forcedPermissionMode
    ? [forcedPermissionMode]
    : (isRoot
      ? ["dontAsk", "acceptEdits", "default"]
      : ["bypassPermissions", "dontAsk", "acceptEdits", "default"]);
  let lastError: Error | null = null;

  for (const mode of modes) {
    try {
      const { args, command } = buildClaudeCommand(baseArgs, mode);

      log.info("Running Claude CLI", {
        mode,
        cwd,
        command,
      });

      const output = await runClaudeCommand(args, cwd, env, entry, onRecord);
      return { output, permissionMode: mode, command };
    } catch (err) {
      const error = err as Error;
      const message = error.message.toLowerCase();
      const isBypassNotAllowed =
        mode === "bypassPermissions" &&
        (message.includes("root") ||
          message.includes("sudo") ||
          message.includes("dangerously-skip-permissions"));
      const isModeUnsupported =
        message.includes("invalid") &&
        message.includes("permission") &&
        message.includes("mode");

      if (isBypassNotAllowed || isModeUnsupported) {
        lastError = error;
        log.warn("Retrying Claude CLI with fallback permission mode", {
          failedMode: mode,
          error: error.message,
        });
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error("Claude CLI failed");
}

export async function sendMessage(
  channelId: string,
  sessionId: string,
  message: string,
  workingPath: string,
  options?: OpenCodeOptions,
  context?: OpenCodeMessageContext
): Promise<OpenCodeMessage[]> {
  const sessionKey = `${channelId}:${sessionId}`;
  const entry = runtime.beginRequest(sessionKey) as { controller: AbortController; process?: ChildProcess };

  try {
    return await runtime.withSessionLock(sessionKey, async () => {
      const agent = options?.agent;
      const forcedPermissionMode = resolveClaudePermissionMode(agent);

      const parts = buildPromptParts(channelId, message, { ...options, agent }, context);
      const prompt = buildPromptText(parts);
      const systemPrompt = buildSystemPrompt(context?.slack);

      const isNewSession = newSessions.has(sessionId);
      if (isNewSession) {
        const fallbackTitle = deriveSessionTitleFromPrompt(message);
        if (fallbackTitle) {
          runtime.publishSessionEvent(sessionId, {
            type: "session.updated",
            properties: {
              sessionID: sessionId,
              info: {
                title: fallbackTitle,
              },
            },
          });
        }
      }
      const args = buildClaudeCommandArgs({
        sessionId,
        isNewSession,
        systemPrompt,
        workingPath,
        prompt,
      });

      const envOverrides = runtime.getSessionEnvironment(sessionId);
      const { output, permissionMode, command } = await runClaudeWithFallback(
        args,
        workingPath,
        envOverrides,
        entry,
        forcedPermissionMode,
        (record) => {
          publishClaudeRecordAsSessionEvents(record, sessionId);
        }
      );

      log.info("Claude CLI response received", { sessionId, permissionMode, command });

      let parsed: { result?: string; is_error?: boolean; error?: string; session_id?: string } | null = null;
      try {
        parsed = parseClaudeResult(output);
      } catch (err) {
        throw new Error(
          `Failed to parse Claude output: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (parsed?.is_error) {
        throw new Error(parsed.error || "Claude returned an error");
      }

      const responseSessionId = parsed?.session_id;
      if (responseSessionId && responseSessionId !== sessionId && context?.slack?.threadId) {
        runtime.setSessionEnvironment(responseSessionId, envOverrides);
        setThreadSessionId(channelId, context.slack.threadId, responseSessionId);
      }

      newSessions.delete(sessionId);
      if (responseSessionId) {
        newSessions.delete(responseSessionId);
      }

      const text = parsed?.result?.trim() ?? "";
      if (!text) {
        throw new Error("Claude returned empty response");
      }

      return [{ text, messageType: "assistant" }];
    });
  } finally {
    runtime.endRequest(sessionKey);
  }
}

export const ensureSession = runtime.ensureSession.bind(runtime);

export const subscribeToSession = runtime.subscribeToSession.bind(runtime);

export const abortSession = runtime.abortSession.bind(runtime);

export const cancelActiveRequest = runtime.cancelActiveRequest.bind(runtime);

export const stopServer = runtime.stopServer.bind(runtime);
export const startServer = noopStartServer;
