import { spawn, type ChildProcess } from "child_process";
import {
  getThreadSessionId,
  setThreadSessionId,
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

type QwenJsonRecord = {
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

const activeRequests = new Map<string, { controller: AbortController; process?: ChildProcess }>();
const sessionLocks = new Map<string, Promise<unknown>>();
const sessionEnvironments = new Map<string, SessionEnvironment>();
const sessionSubscribers = new Map<string, Set<(event: unknown) => void>>();
const newSessions = new Set<string>();

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

function formatShellCommand(args: string[]): string {
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

function resolveQwenBinary(): string {
  if (typeof Bun !== "undefined") {
    if (Bun.which("qwen")) return "qwen";
    if (Bun.which("qwen-code")) return "qwen-code";
  }
  return "qwen";
}

export function buildQwenCommandArgs(params: {
  sessionId: string;
  isNewSession: boolean;
  prompt: string;
  approvalMode?: "plan";
}): string[] {
  const args = [
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ];
  if (params.approvalMode === "plan") {
    args.push("--approval-mode", "plan");
  } else {
    args.push("--yolo");
  }
  if (!params.isNewSession) {
    args.push("--resume", params.sessionId);
  }
  args.push("-p", params.prompt);
  return args;
}

export function buildQwenCommand(args: string[]): string {
  return formatShellCommand([resolveQwenBinary(), ...args]);
}

function getRecordSessionId(record: QwenJsonRecord, fallbackSessionId: string): string {
  return typeof record.session_id === "string" ? record.session_id : fallbackSessionId;
}

function publishSessionEvent(sessionId: string, event: unknown): void {
  const handlers = sessionSubscribers.get(sessionId);
  if (!handlers || handlers.size === 0) return;
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (err) {
      log.warn("Qwen session subscriber failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function publishQwenRecordAsSessionEvents(record: QwenJsonRecord, fallbackSessionId: string): void {
  const sessionId = getRecordSessionId(record, fallbackSessionId);
  const rawType = typeof record.type === "string" && record.type.trim()
    ? record.type.trim()
    : "unknown";
  const eventPayload = {
    type: `qwen.raw.${rawType}`,
    properties: {
      record,
      recordType: rawType,
      streamEventType: typeof record.event?.type === "string" ? record.event.type : undefined,
    },
  };
  publishSessionEvent(sessionId, eventPayload);
  if (sessionId !== fallbackSessionId) {
    publishSessionEvent(fallbackSessionId, eventPayload);
  }
}

async function runQwenCommand(
  args: string[],
  cwd: string,
  env: SessionEnvironment,
  entry: { controller: AbortController; process?: ChildProcess },
  onRecord?: (record: QwenJsonRecord) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveQwenBinary(), args, {
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
        onRecord(JSON.parse(trimmed) as QwenJsonRecord);
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
      reject(new Error("Qwen CLI timed out"));
    }, 10 * 60 * 1000);

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

      log.info("Qwen CLI completed", {
        code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      if (code !== 0) {
        reject(new Error(stderr || `Qwen CLI exited with code ${code}`));
        return;
      }

      if (stderr) {
        log.warn("Qwen CLI stderr", { stderr });
      }

      resolve(stdout);
    });
  });
}

function parseQwenResponse(output: string): {
  text: string;
  sessionId?: string;
} {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let sessionId: string | undefined;
  let resultText = "";
  let errorMessage: string | undefined;
  const assistantChunks: string[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as QwenJsonRecord;
      if (typeof record.session_id === "string" && record.session_id.trim()) {
        sessionId = record.session_id;
      }
      if (record.type === "assistant") {
        const text = (record.message?.content ?? [])
          .filter((part) => part?.type === "text")
          .map((part) => part.text ?? "")
          .join("")
          .trim();
        if (text) assistantChunks.push(text);
      }
      if (record.type === "result") {
        if (record.is_error) {
          errorMessage = record.error || "Qwen returned an error";
        }
        if (typeof record.result === "string") {
          resultText = record.result.trim();
        }
      }
    } catch {
      // ignore non-json stream lines
    }
  }

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const text = (resultText || assistantChunks.join("\n\n")).trim();
  if (!text) {
    throw new Error("Qwen returned empty response");
  }

  return { text, sessionId };
}

export async function createSession(workingPath: string, env?: SessionEnvironment): Promise<string> {
  const sessionId = crypto.randomUUID();
  sessionEnvironments.set(sessionId, env ?? {});
  newSessions.add(sessionId);
  log.info("Created Qwen session", { sessionId, workingPath });
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
    const existingEnv = normalizeSessionEnvironment(sessionEnvironments.get(existingSession));
    const desiredEnv = normalizeSessionEnvironment(env);
    if (existingEnv !== desiredEnv) {
      log.info("Qwen session environment changed; creating new session", {
        channelId,
        threadId,
        workingPath,
      });
      const sessionId = await createSession(workingPath, env);
      setThreadSessionId(channelId, threadId, sessionId);
      return { sessionId, created: true };
    }

    if (!sessionEnvironments.has(existingSession)) {
      sessionEnvironments.set(existingSession, env);
    }

    return { sessionId: existingSession, created: false };
  }

  log.info("Creating new Qwen session for thread", { channelId, threadId, workingPath });
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
      const approvalMode = agent?.trim().toLowerCase() === "plan" ? "plan" : undefined;
      const parts = buildPromptParts(channelId, message, { ...options, agent }, context);
      const prompt = buildPromptText(parts);
      const systemPrompt = buildSystemPrompt(context?.slack);
      const qwenPrompt = `<system-prompt>\n${systemPrompt}\n</system-prompt>\n\n${prompt}`;
      const isNewSession = newSessions.has(sessionId);

      const args = buildQwenCommandArgs({
        sessionId,
        isNewSession,
        prompt: qwenPrompt,
        approvalMode,
      });
      const command = buildQwenCommand(args);
      const envOverrides = sessionEnvironments.get(sessionId) ?? {};

      log.info("Running Qwen CLI", {
        cwd: workingPath,
        command,
        isNewSession,
      });

      let latestSessionId = sessionId;
      const output = await runQwenCommand(args, workingPath, envOverrides, entry, (record) => {
        const recordSessionId = getRecordSessionId(record, sessionId);
        latestSessionId = recordSessionId;
        publishQwenRecordAsSessionEvents(record, sessionId);
      });

      const parsed = parseQwenResponse(output);
      const responseSessionId = parsed.sessionId || latestSessionId;
      if (responseSessionId && responseSessionId !== sessionId && context?.slack?.threadId) {
        sessionEnvironments.set(responseSessionId, envOverrides);
        setThreadSessionId(channelId, context.slack.threadId, responseSessionId);
      }

      newSessions.delete(sessionId);
      if (responseSessionId) {
        newSessions.delete(responseSessionId);
      }

      return [{ text: parsed.text, messageType: "assistant" }];
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
