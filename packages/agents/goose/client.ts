import { spawn, type ChildProcess } from "child_process";
import {
  getThreadSessionId,
  setThreadSessionId,
} from "@/config/local/settings";
import { log } from "@/utils";
import { buildPromptParts, buildPromptText, buildSystemPrompt } from "../shared";
import {
  CliAgentRuntime,
  formatShellCommand,
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

type GooseJsonRecord = {
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
  role?: string;
  content?: string;
  text?: string;
  result?: string;
  output?: string;
  is_error?: boolean;
  error?: string;
  session_id?: string;
  sessionId?: string;
  sessionID?: string;
};

const runtime = new CliAgentRuntime("Goose");
const newSessions = new Set<string>();

function resolveGooseBinary(): string {
  if (typeof Bun !== "undefined" && Bun.which("goose")) return "goose";
  return "goose";
}

export function buildGooseCommandArgs(params: {
  sessionId: string;
  isNewSession: boolean;
  prompt: string;
}): string[] {
  const args = [
    "run",
    "--output-format",
    "stream-json",
    "--name",
    params.sessionId,
  ];
  if (!params.isNewSession) {
    args.push("--resume");
  }
  args.push("-t", params.prompt);
  return args;
}

export function buildGooseCommand(args: string[]): string {
  return formatShellCommand([resolveGooseBinary(), ...args]);
}

function getRecordSessionId(record: GooseJsonRecord, fallbackSessionId: string): string {
  if (typeof record.session_id === "string") return record.session_id;
  if (typeof record.sessionId === "string") return record.sessionId;
  if (typeof record.sessionID === "string") return record.sessionID;
  return fallbackSessionId;
}

function publishGooseRecordAsSessionEvents(record: GooseJsonRecord, fallbackSessionId: string): void {
  const sessionId = getRecordSessionId(record, fallbackSessionId);
  const rawType = typeof record.type === "string" && record.type.trim()
    ? record.type.trim()
    : typeof record.role === "string" && record.role.trim()
      ? record.role.trim()
      : "unknown";
  const eventPayload = {
    type: `goose.raw.${rawType}`,
    properties: {
      record,
      recordType: rawType,
      streamEventType: typeof record.event?.type === "string" ? record.event.type : undefined,
    },
  };
  runtime.publishSessionEvent(sessionId, eventPayload);
  if (sessionId !== fallbackSessionId) {
    runtime.publishSessionEvent(fallbackSessionId, eventPayload);
  }
}

function textFromRecord(record: GooseJsonRecord): string {
  if (typeof record.result === "string" && record.result.trim()) return record.result.trim();
  if (typeof record.output === "string" && record.output.trim()) return record.output.trim();
  if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
  if (typeof record.content === "string" && record.content.trim()) return record.content.trim();
  const content = record.message?.content ?? [];
  const joined = content
    .filter((part) => part?.type === "text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  return joined;
}

async function runGooseCommand(
  args: string[],
  cwd: string,
  env: SessionEnvironment,
  entry: { controller: AbortController; process?: ChildProcess },
  onRecord?: (record: GooseJsonRecord) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveGooseBinary(), args, {
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
        onRecord(JSON.parse(trimmed) as GooseJsonRecord);
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
      reject(new Error("Goose CLI timed out"));
    }, 20 * 60 * 1000);

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (stdoutBuffer.trim().length > 0) {
        flushLine(stdoutBuffer);
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();

      log.info("Goose CLI completed", {
        code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      if (code !== 0) {
        reject(new Error(stderr || `Goose CLI exited with code ${code}`));
        return;
      }

      if (stderr) {
        log.warn("Goose CLI stderr", { stderr });
      }

      resolve(stdout);
    });
  });
}

function parseGooseResponse(output: string): {
  text: string;
  sessionId?: string;
} {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let sessionId: string | undefined;
  let errorMessage: string | undefined;
  let resultText = "";
  const assistantChunks: string[] = [];
  const plainChunks: string[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as GooseJsonRecord;
      const recordSessionId = getRecordSessionId(record, "").trim();
      if (recordSessionId) {
        sessionId = recordSessionId;
      }

      const recordText = textFromRecord(record);
      if (recordText) {
        assistantChunks.push(recordText);
      }

      if (record.is_error) {
        errorMessage = record.error || "Goose returned an error";
      }

      const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
      if ((type === "result" || type.endsWith("completed")) && recordText) {
        resultText = recordText;
      }
    } catch {
      plainChunks.push(line);
    }
  }

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const text = (resultText || assistantChunks[assistantChunks.length - 1] || plainChunks.join("\n")).trim();
  if (!text) {
    throw new Error("Goose returned empty response");
  }

  return { text, sessionId };
}

export async function createSession(workingPath: string, env?: SessionEnvironment): Promise<string> {
  const sessionId = crypto.randomUUID();
  runtime.setSessionEnvironment(sessionId, env ?? {});
  newSessions.add(sessionId);
  log.info("Created Goose session", { sessionId, workingPath });
  return sessionId;
}

export async function getOrCreateSession(
  channelId: string,
  threadId: string,
  workingPath: string,
  env: SessionEnvironment = {}
): Promise<OpenCodeSessionInfo> {
  const existingSession = getThreadSessionId(channelId, threadId);
  if (existingSession) {
    const existingEnv = normalizeSessionEnvironment(runtime.getSessionEnvironment(existingSession));
    const desiredEnv = normalizeSessionEnvironment(env);
    if (existingEnv !== desiredEnv) {
      log.info("Goose session environment changed; creating new session", {
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

  log.info("Creating new Goose session for thread", { channelId, threadId, workingPath });
  const sessionId = await createSession(workingPath, env);
  setThreadSessionId(channelId, threadId, sessionId);
  return { sessionId, created: true };
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
      const parts = buildPromptParts(channelId, message, { ...options, agent }, context);
      const prompt = buildPromptText(parts);
      const systemPrompt = buildSystemPrompt(context?.slack);
      const goosePrompt = `<system-prompt>\n${systemPrompt}\n</system-prompt>\n\n${prompt}`;
      const isNewSession = newSessions.has(sessionId);

      const args = buildGooseCommandArgs({
        sessionId,
        isNewSession,
        prompt: goosePrompt,
      });
      const command = buildGooseCommand(args);
      const envOverrides = runtime.getSessionEnvironment(sessionId);

      log.info("Running Goose CLI", {
        cwd: workingPath,
        command,
        isNewSession,
      });

      let latestSessionId = sessionId;
      const output = await runGooseCommand(args, workingPath, envOverrides, entry, (record) => {
        const recordSessionId = getRecordSessionId(record, sessionId);
        latestSessionId = recordSessionId;
        publishGooseRecordAsSessionEvents(record, sessionId);
      });

      const parsed = parseGooseResponse(output);
      const responseSessionId = parsed.sessionId || latestSessionId;
      if (responseSessionId && responseSessionId !== sessionId && context?.slack?.threadId) {
        runtime.setSessionEnvironment(responseSessionId, envOverrides);
        setThreadSessionId(channelId, context.slack.threadId, responseSessionId);
      }

      newSessions.delete(sessionId);
      if (responseSessionId) {
        newSessions.delete(responseSessionId);
      }

      return [{ text: parsed.text, messageType: "assistant" }];
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
