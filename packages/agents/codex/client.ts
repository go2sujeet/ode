import { spawn, type ChildProcess } from "child_process";
import { DEFAULT_CODEX_MODEL, getCodexModels, setCodexModels } from "@/config";
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

type CodexJsonEvent = {
  type?: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
  };
  error?: {
    message?: string;
  };
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

function buildCodexPrompt(systemPrompt: string, prompt: string): string {
  return `<system-prompt>\n${systemPrompt}\n</system-prompt>\n\n${prompt}`;
}

function getCodexModel(options?: OpenCodeOptions): string | undefined {
  const configured = options?.model?.modelID?.trim();
  if (configured) return configured;
  return DEFAULT_CODEX_MODEL;
}

type CodexModelCatalog = {
  models?: Array<{ slug?: string }>;
};

function extractCodexModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const catalog = payload as CodexModelCatalog;
  if (!Array.isArray(catalog.models)) return [];
  return catalog.models
    .map((entry) => (typeof entry?.slug === "string" ? entry.slug.trim() : ""))
    .filter(Boolean);
}

async function syncCodexModelsFromCache(): Promise<void> {
  const home = process.env.HOME?.trim();
  if (!home) return;
  const cacheFile = Bun.file(`${home}/.codex/models_cache.json`);
  if (!(await cacheFile.exists())) return;

  try {
    const payload = JSON.parse(await cacheFile.text());
    const models = Array.from(new Set([...extractCodexModels(payload), DEFAULT_CODEX_MODEL])).sort();
    if (models.length === 0) return;
    const existing = getCodexModels();
    if (JSON.stringify(existing) === JSON.stringify(models)) return;
    setCodexModels(models);
    log.info("Codex models synced", { count: models.length });
  } catch (error) {
    log.warn("Codex model sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function buildCodexCommandArgs(params: {
  sessionId: string;
  prompt: string;
  model?: string;
  planMode?: boolean;
}): string[] {
  const args = [
    "exec",
    "resume",
    "--json",
    "--skip-git-repo-check",
  ];
  if (params.planMode) {
    args.push("--sandbox", "read-only");
  } else {
    args.push("--full-auto");
  }
  if (params.model) {
    args.push("--model", params.model);
  }
  args.push(params.sessionId, params.prompt);
  return args;
}

export function buildCodexCommand(args: string[]): string {
  return formatShellCommand(["codex", ...args]);
}

function publishSessionEvent(sessionId: string, event: unknown): void {
  const handlers = sessionSubscribers.get(sessionId);
  if (!handlers || handlers.size === 0) return;
  for (const handler of handlers) {
    try {
      handler(event);
    } catch (err) {
      log.warn("Codex session subscriber failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function publishCodexEvent(sessionId: string, event: CodexJsonEvent): void {
  const rawType = typeof event.type === "string" && event.type.trim()
    ? event.type.trim()
    : "unknown";
  publishSessionEvent(sessionId, {
    type: `codex.raw.${rawType}`,
    properties: {
      event,
      eventType: rawType,
    },
  });
}

async function runCodexCommand(
  args: string[],
  cwd: string,
  env: SessionEnvironment,
  entry: { controller: AbortController; process?: ChildProcess },
  onEvent?: (event: CodexJsonEvent) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
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
      if (!trimmed || !onEvent) return;
      try {
        onEvent(JSON.parse(trimmed) as CodexJsonEvent);
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
      reject(new Error("Codex CLI timed out"));
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

      log.info("Codex CLI completed", {
        code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      if (code !== 0) {
        reject(new Error(stderr || `Codex CLI exited with code ${code}`));
        return;
      }

      if (stderr) {
        log.warn("Codex CLI stderr", { stderr });
      }

      resolve(stdout);
    });
  });
}

function parseCodexResponse(output: string): {
  text: string;
  threadId?: string;
} {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const messages: string[] = [];
  let threadId: string | undefined;
  let errorMessage: string | undefined;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as CodexJsonEvent;
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        threadId = event.thread_id;
      }
      if (event.type === "item.completed" && event.item?.type === "agent_message") {
        if (typeof event.item.text === "string" && event.item.text.trim()) {
          messages.push(event.item.text);
        }
      }
      if (event.type === "error") {
        errorMessage = event.error?.message || "Codex returned an error";
      }
    } catch {
      // ignore non-json lines
    }
  }

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const text = messages.join("\n\n").trim();
  if (!text) {
    throw new Error("Codex returned empty response");
  }

  return { text, threadId };
}

export async function createSession(workingPath: string, env?: SessionEnvironment): Promise<string> {
  const sessionId = crypto.randomUUID();
  sessionEnvironments.set(sessionId, env ?? {});
  log.info("Created Codex session", { sessionId, workingPath });
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
      log.info("Codex session environment changed; creating new session", {
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

  log.info("Creating new Codex session for thread", { channelId, threadId, workingPath });
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
    await syncCodexModelsFromCache();
    return await withSessionLock(sessionKey, async () => {
      const agent = options?.agent;
      const planMode = agent?.trim().toLowerCase() === "plan";
      const parts = buildPromptParts(channelId, message, { ...options, agent }, context);
      const prompt = buildPromptText(parts);
      const systemPrompt = buildSystemPrompt(context?.slack);
      const codexPrompt = buildCodexPrompt(systemPrompt, prompt);
      const model = getCodexModel(options);

      const args = buildCodexCommandArgs({
        sessionId,
        prompt: codexPrompt,
        model,
        planMode,
      });

      const command = buildCodexCommand(args);
      const envOverrides = sessionEnvironments.get(sessionId) ?? {};

      log.info("Running Codex CLI", {
        cwd: workingPath,
        command,
        model,
      });

      let latestSessionId = sessionId;
      const output = await runCodexCommand(args, workingPath, envOverrides, entry, (event) => {
        if (event.type === "thread.started" && typeof event.thread_id === "string") {
          latestSessionId = event.thread_id;
        }
        publishCodexEvent(sessionId, event);
        if (latestSessionId !== sessionId) {
          publishCodexEvent(latestSessionId, event);
        }
      });

      const parsed = parseCodexResponse(output);
      const responseSessionId = parsed.threadId || latestSessionId;
      if (responseSessionId && responseSessionId !== sessionId && context?.slack?.threadId) {
        sessionEnvironments.set(responseSessionId, envOverrides);
        setThreadSessionId(channelId, context.slack.threadId, responseSessionId);
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
  await syncCodexModelsFromCache();
}
