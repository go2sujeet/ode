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

type KimiJsonRecord = {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
};

const activeRequests = new Map<string, { controller: AbortController; process?: ChildProcess }>();
const sessionLocks = new Map<string, Promise<unknown>>();
const sessionEnvironments = new Map<string, SessionEnvironment>();
const sessionSubscribers = new Map<string, Set<(event: unknown) => void>>();

function normalizeSessionEnvironment(env?: SessionEnvironment | null): string {
  if (!env) return "";
  return Object.keys(env)
    .sort()
    .map((key) => `${key}=${env[key]}`)
    .join("\n");
}

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

const KIMI_PLAN_SYSTEM_PROMPT = [
  "PLAN MODE REQUIREMENT:",
  "- This turn is planning-only.",
  "- Do not modify files.",
  "- Do not execute shell commands.",
  "- Return an implementation plan and risk notes.",
].join("\n");

function buildKimiSystemPrompt(baseSystemPrompt: string, agent?: string): string {
  if (agent?.trim().toLowerCase() !== "plan") {
    return baseSystemPrompt;
  }
  return `${baseSystemPrompt}\n\n${KIMI_PLAN_SYSTEM_PROMPT}`;
}

export function buildKimiCommandArgs(params: {
  sessionId: string;
  workingPath: string;
  prompt: string;
}): string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--session",
    params.sessionId,
    "--work-dir",
    params.workingPath,
    "-p",
    params.prompt,
  ];
}

export function buildKimiCommand(args: string[]): string {
  return formatShellCommand(["kimi", ...args]);
}

function publishSessionEvent(sessionId: string, event: unknown): void {
  const handlers = sessionSubscribers.get(sessionId);
  if (!handlers || handlers.size === 0) return;
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (err) {
      log.warn("Kimi session subscriber failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function publishKimiEvent(sessionId: string, record: KimiJsonRecord): void {
  const role = typeof record.role === "string" && record.role.trim() ? record.role.trim() : "unknown";
  publishSessionEvent(sessionId, {
    type: `kimi.raw.${role}`,
    properties: {
      record,
      role,
    },
  });
}

async function runKimiCommand(
  args: string[],
  cwd: string,
  env: SessionEnvironment,
  entry: { controller: AbortController; process?: ChildProcess },
  onRecord?: (record: KimiJsonRecord) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("kimi", args, {
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
        onRecord(JSON.parse(trimmed) as KimiJsonRecord);
      } catch {
        // ignore non-json lines
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
      reject(new Error("Kimi CLI timed out"));
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

      log.info("Kimi CLI completed", {
        code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      if (code !== 0) {
        reject(new Error(stderr || `Kimi CLI exited with code ${code}`));
        return;
      }

      if (stderr) {
        log.warn("Kimi CLI stderr", { stderr });
      }

      resolve(stdout);
    });
  });
}

function contentToText(content: KimiJsonRecord["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function parseKimiResponse(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const assistantMessages: string[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as KimiJsonRecord;
      if (record.role !== "assistant") continue;
      const text = contentToText(record.content).trim();
      if (text) assistantMessages.push(text);
    } catch {
      // ignore non-json lines
    }
  }

  const text = assistantMessages.join("\n\n").trim();
  if (!text) {
    throw new Error("Kimi returned empty response");
  }
  return text;
}

export async function createSession(workingPath: string, env?: SessionEnvironment): Promise<string> {
  const sessionId = crypto.randomUUID();
  sessionEnvironments.set(sessionId, env ?? {});
  log.info("Created Kimi session", { sessionId, workingPath });
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
      log.info("Kimi session environment changed; creating new session", {
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

  log.info("Creating new Kimi session for thread", { channelId, threadId, workingPath });
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
      const parts = buildPromptParts(channelId, message, { ...options, agent }, context);
      const prompt = buildPromptText(parts);
      const systemPrompt = buildKimiSystemPrompt(buildSystemPrompt(context?.slack), agent);
      const kimiPrompt = `<system-prompt>\n${systemPrompt}\n</system-prompt>\n\n${prompt}`;

      const args = buildKimiCommandArgs({
        sessionId,
        workingPath,
        prompt: kimiPrompt,
      });
      const command = buildKimiCommand(args);
      const envOverrides = sessionEnvironments.get(sessionId) ?? {};

      log.info("Running Kimi CLI", {
        cwd: workingPath,
        command,
      });

      const output = await runKimiCommand(args, workingPath, envOverrides, entry, (record) => {
        publishKimiEvent(sessionId, record);
      });
      const text = parseKimiResponse(output);
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
