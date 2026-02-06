import { spawn, type ChildProcess } from "child_process";
import {
  getOpenCodeSession,
  setOpenCodeSession,
} from "@/config/local/settings";
import { log } from "@/utils";
import { buildPromptParts, buildPromptText, buildSystemPrompt } from "../shared";
import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "../types";

export type SessionEnvironment = Record<string, string>;

const activeRequests = new Map<string, { controller: AbortController; process?: ChildProcess }>();
const sessionLocks = new Map<string, Promise<unknown>>();
const sessionEnvironments = new Map<string, SessionEnvironment>();
const sessionSubscribers = new Map<string, Set<(event: unknown) => void>>();
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

type SessionLikeEvent = {
  type: string;
  properties: Record<string, unknown>;
};

async function withSessionLock<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
  const existing = sessionLocks.get(sessionKey);
  if (existing) {
    await existing.catch(() => {});
  }

  const promise = fn();
  sessionLocks.set(sessionKey, promise);

  try {
    return await promise;
  } finally {
    sessionLocks.delete(sessionKey);
  }
}

function normalizeSessionEnvironment(env?: SessionEnvironment | null): string {
  if (!env) return "";
  return Object.keys(env)
    .sort()
    .map((key) => `${key}=${env[key]}`)
    .join("\n");
}

function isValidUuid(value: string): boolean {
  return uuidRegex.test(value);
}

export async function createSession(workingPath: string, env?: SessionEnvironment): Promise<string> {
  const sessionId = crypto.randomUUID();
  sessionEnvironments.set(sessionId, env ?? {});
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
  const existingSession = getOpenCodeSession(channelId, threadId);
  if (existingSession) {
    if (!isValidUuid(existingSession)) {
      log.info("Invalid Claude session id found; generating new session", {
        channelId,
        threadId,
        workingPath,
        existingSession,
      });
      const sessionId = await createSession(workingPath, env);
      setOpenCodeSession(channelId, threadId, sessionId);
      return { sessionId, created: true };
    }

    const existingEnv = normalizeSessionEnvironment(sessionEnvironments.get(existingSession));
    const desiredEnv = normalizeSessionEnvironment(env);
    if (existingEnv !== desiredEnv) {
      log.info("Claude session environment changed; creating new session", {
        channelId,
        threadId,
        workingPath,
      });
      const sessionId = await createSession(workingPath, env);
      setOpenCodeSession(channelId, threadId, sessionId);
      return { sessionId, created: true };
    }

    if (!sessionEnvironments.has(existingSession)) {
      sessionEnvironments.set(existingSession, env);
    }

    return { sessionId: existingSession, created: false };
  }

  log.info("Creating new Claude session for thread", { channelId, threadId, workingPath });
  const sessionId = await createSession(workingPath, env);
  setOpenCodeSession(channelId, threadId, sessionId);
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

function getRecordSessionId(record: ClaudeJsonRecord, fallbackSessionId: string): string {
  return typeof record.session_id === "string" ? record.session_id : fallbackSessionId;
}

function publishSessionEvent(sessionId: string, event: unknown): void {
  const handlers = sessionSubscribers.get(sessionId);
  if (!handlers || handlers.size === 0) return;
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (err) {
      log.warn("Claude session subscriber failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function statusFromClaudeRecord(
  record: ClaudeJsonRecord,
  toolByIndex: Map<number, { id: string; name: string }>
): string | null {
  if (record.type === "assistant") {
    return "Drafting response";
  }
  if (record.type === "result") {
    return record.is_error ? "Claude reported an error" : "Finalizing response";
  }
  if (record.type !== "stream_event" || !record.event?.type) {
    return null;
  }

  switch (record.event.type) {
    case "message_start":
      return "Thinking";
    case "content_block_start": {
      const block = record.event.content_block;
      if (block?.type === "tool_use") {
        const toolName = typeof block.name === "string" ? block.name : "tool";
        return `Running tool: ${toolName}`;
      }
      return "Drafting response";
    }
    case "content_block_delta": {
      const delta = record.event.delta;
      if (delta?.type === "text_delta") {
        return "Drafting response";
      }
      if (delta?.type === "input_json_delta") {
        const index = typeof record.event?.index === "number" ? record.event.index : -1;
        const tool = toolByIndex.get(index);
        return tool ? `Running tool: ${tool.name}` : "Running tool";
      }
      return null;
    }
    case "content_block_stop": {
      const index = typeof record.event.index === "number" ? record.event.index : -1;
      const tool = toolByIndex.get(index);
      return tool ? `Finished tool: ${tool.name}` : "Finished step";
    }
    case "message_stop":
      return "Finalizing response";
    default:
      return null;
  }
}

export function mapClaudeRecordToSessionEvents(
  record: unknown,
  fallbackSessionId: string,
  textByIndex: Map<number, string>,
  toolByIndex: Map<number, { id: string; name: string }>
): SessionLikeEvent[] {
  const parsedRecord = record as ClaudeJsonRecord;
  const events: SessionLikeEvent[] = [];
  const sessionId = getRecordSessionId(parsedRecord, fallbackSessionId);
  const status = statusFromClaudeRecord(parsedRecord, toolByIndex);
  if (status) {
    events.push({
      type: "session.status",
      properties: {
        sessionID: sessionId,
        status,
      },
    });
  }

  if (parsedRecord.type === "assistant") {
    const text = parsedRecord.message?.content
      ?.filter((block) => block?.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    if (text) {
      events.push({
        type: "message.part.updated",
        properties: {
          part: {
            type: "text",
            text,
            sessionID: sessionId,
          },
        },
      });
    }
    return events;
  }

  if (parsedRecord.type !== "stream_event" || !parsedRecord.event?.type) {
    return events;
  }

  const eventType = parsedRecord.event.type;
  const index = typeof parsedRecord.event.index === "number" ? parsedRecord.event.index : -1;

  if (eventType === "content_block_start") {
    const contentBlock = parsedRecord.event.content_block;
    if (contentBlock?.type === "tool_use") {
      const id = typeof contentBlock.id === "string" ? contentBlock.id : `tool-${Date.now()}-${index}`;
      const name = typeof contentBlock.name === "string" ? contentBlock.name : "tool";
      toolByIndex.set(index, { id, name });
      events.push({
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            id,
            tool: name,
            sessionID: sessionId,
            state: {
              status: "running",
              input:
                contentBlock && typeof contentBlock.input === "object"
                  ? (contentBlock.input as Record<string, unknown>)
                  : {},
            },
          },
        },
      });
    }
    return events;
  }

  if (eventType === "content_block_delta") {
    const delta = parsedRecord.event.delta;
    if (delta?.type === "text_delta") {
      const chunk = typeof delta.text === "string" ? delta.text : "";
      if (!chunk) return events;
      const next = `${textByIndex.get(index) ?? ""}${chunk}`;
      textByIndex.set(index, next);
      events.push({
        type: "message.part.updated",
        properties: {
          part: {
            type: "text",
            text: next,
            sessionID: sessionId,
          },
        },
      });
      return events;
    }

    if (delta?.type === "input_json_delta") {
      const tool = toolByIndex.get(index);
      if (!tool) return events;
      events.push({
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            id: tool.id,
            tool: tool.name,
            sessionID: sessionId,
            state: {
              status: "running",
            },
          },
        },
      });
    }
    return events;
  }

  if (eventType === "content_block_stop") {
    const tool = toolByIndex.get(index);
    if (!tool) return events;
    events.push({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          id: tool.id,
          tool: tool.name,
          sessionID: sessionId,
          state: {
            status: "completed",
          },
        },
      },
    });
  }

  return events;
}

function publishClaudeRecordAsSessionEvents(
  record: ClaudeJsonRecord,
  fallbackSessionId: string,
  textByIndex: Map<number, string>,
  toolByIndex: Map<number, { id: string; name: string }>
): void {
  for (const event of mapClaudeRecordToSessionEvents(record, fallbackSessionId, textByIndex, toolByIndex)) {
    publishSessionEvent(getRecordSessionId(record, fallbackSessionId), event);
  }
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
  onRecord?: (record: ClaudeJsonRecord) => void
): Promise<{ output: string; permissionMode: string; command: string }> {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const modes = isRoot
    ? ["dontAsk", "acceptEdits", "default"]
    : ["bypassPermissions", "dontAsk", "acceptEdits", "default"];
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

  const existingEntry = activeRequests.get(sessionKey);
  if (existingEntry) {
    existingEntry.controller.abort();
    existingEntry.process?.kill("SIGTERM");
  }

  const entry = { controller: new AbortController() };
  activeRequests.set(sessionKey, entry);

  try {
    return await withSessionLock(sessionKey, async () => {
      const agent = options?.agent;

      const parts = buildPromptParts(channelId, message, { ...options, agent }, context);
      const prompt = buildPromptText(parts);
      const systemPrompt = buildSystemPrompt(context?.slack);

      const isNewSession = newSessions.has(sessionId);
      const args = buildClaudeCommandArgs({
        sessionId,
        isNewSession,
        systemPrompt,
        workingPath,
        prompt,
      });

      const envOverrides = sessionEnvironments.get(sessionId) ?? {};
      const textByIndex = new Map<number, string>();
      const toolByIndex = new Map<number, { id: string; name: string }>();
      const { output, permissionMode, command } = await runClaudeWithFallback(
        args,
        workingPath,
        envOverrides,
        entry,
        (record) => {
          publishClaudeRecordAsSessionEvents(record, sessionId, textByIndex, toolByIndex);
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
        sessionEnvironments.set(responseSessionId, envOverrides);
        setOpenCodeSession(channelId, context.slack.threadId, responseSessionId);
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
    activeRequests.delete(sessionKey);
  }
}

export async function ensureSession(sessionId: string): Promise<void> {
  if (!sessionEnvironments.has(sessionId)) {
    sessionEnvironments.set(sessionId, {});
  }
}

export function subscribeToSession(sessionId: string, handler: (event: unknown) => void): () => void {
  const handlers = sessionSubscribers.get(sessionId) ?? new Set<(event: unknown) => void>();
  handlers.add(handler);
  sessionSubscribers.set(sessionId, handlers);

  return () => {
    const activeHandlers = sessionSubscribers.get(sessionId);
    if (!activeHandlers) return;
    activeHandlers.delete(handler);
    if (activeHandlers.size === 0) {
      sessionSubscribers.delete(sessionId);
    }
  };
}

export async function abortSession(sessionId: string, _directory?: string): Promise<void> {
  for (const [sessionKey, entry] of activeRequests) {
    if (sessionKey.endsWith(`:${sessionId}`)) {
      entry.controller.abort();
      entry.process?.kill("SIGTERM");
      activeRequests.delete(sessionKey);
    }
  }
}

export async function cancelActiveRequest(
  channelId: string,
  sessionId: string,
  _directory?: string
): Promise<boolean> {
  const sessionKey = `${channelId}:${sessionId}`;
  const entry = activeRequests.get(sessionKey);
  if (!entry) return false;

  entry.controller.abort();
  entry.process?.kill("SIGTERM");
  activeRequests.delete(sessionKey);
  return true;
}

export function stopServer(): void {
  for (const entry of activeRequests.values()) {
    entry.controller.abort();
    entry.process?.kill("SIGTERM");
  }
  activeRequests.clear();
  sessionSubscribers.clear();
}

export async function startServer(): Promise<void> {
  return;
}
