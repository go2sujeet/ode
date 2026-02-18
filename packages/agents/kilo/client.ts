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

type KiloToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
};

type KiloContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
};

type KiloJsonRecord = {
  type?: string;
  role?: string;
  event?: {
    type?: string;
    index?: number;
    content_block?: Record<string, unknown>;
    delta?: Record<string, unknown>;
  };
  message?: {
    content?: KiloContentBlock[];
  };
  content?: KiloContentBlock[] | string;
  tool_calls?: KiloToolCall[];
  tool_call_id?: string;
  result?: string;
  output?: string;
  text?: string;
  is_error?: boolean;
  error?: string;
  session_id?: string;
  sessionId?: string;
  sessionID?: string;
};

const runtime = new CliAgentRuntime("Kilo");
const newSessions = new Set<string>();
const kiloSessionPrefix = "ses_";

function resolveKiloBinary(): string {
  if (typeof Bun !== "undefined") {
    if (Bun.which("kilo")) return "kilo";
  }
  return "kilo";
}

function buildKiloSessionId(): string {
  return `${kiloSessionPrefix}${crypto.randomUUID()}`;
}

function isValidKiloSessionId(value: string): boolean {
  return value.startsWith("ses");
}

function buildModelArg(model?: OpenCodeOptions["model"]): string | undefined {
  if (!model?.modelID) return undefined;
  const providerID = model.providerID?.trim() || "openai";
  return `${providerID}/${model.modelID}`;
}

export function buildKiloCommandArgs(params: {
  sessionId: string;
  prompt: string;
  agent?: string;
  model?: OpenCodeOptions["model"];
  isNewSession?: boolean;
}): string[] {
  const args = [
    "run",
    "--auto",
    "--format",
    "json",
  ];
  if (!params.isNewSession) {
    args.push("--session", params.sessionId);
  }
  if (params.agent?.trim()) {
    args.push("--agent", params.agent.trim());
  }
  const modelArg = buildModelArg(params.model);
  if (modelArg) {
    args.push("--model", modelArg);
  }
  args.push(params.prompt);
  return args;
}

export function buildKiloCommand(args: string[]): string {
  return formatShellCommand([resolveKiloBinary(), ...args]);
}

function sanitizeKiloOutput(text: string): string {
  return text
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B[@-_]/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g, "")
    .replace(/[ \t]+$/gm, "");
}

function getRecordSessionId(record: KiloJsonRecord, fallbackSessionId: string): string {
  if (typeof record.session_id === "string") return record.session_id;
  if (typeof record.sessionId === "string") return record.sessionId;
  if (typeof record.sessionID === "string") return record.sessionID;
  return fallbackSessionId;
}

function publishKiloRecordAsSessionEvents(record: KiloJsonRecord, fallbackSessionId: string): void {
  const sessionId = getRecordSessionId(record, fallbackSessionId);
  const rawType = typeof record.type === "string" && record.type.trim()
    ? record.type.trim()
    : typeof record.role === "string" && record.role.trim()
      ? record.role.trim()
      : "unknown";
  const eventPayload = {
    type: `kilo.raw.${rawType}`,
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

function contentBlocks(record: KiloJsonRecord): KiloContentBlock[] {
  if (Array.isArray(record.message?.content)) return record.message?.content ?? [];
  if (Array.isArray(record.content)) return record.content as KiloContentBlock[];
  return [];
}

function textFromContent(record: KiloJsonRecord): string {
  if (typeof record.result === "string" && record.result.trim()) return record.result.trim();
  if (typeof record.text === "string" && record.text.trim()) return record.text.trim();
  if (typeof record.output === "string" && record.output.trim()) return record.output.trim();
  if (typeof record.content === "string" && record.content.trim()) return record.content.trim();
  const blocks = contentBlocks(record);
  const text = blocks
    .map((block) => {
      if (typeof block.text === "string") return block.text;
      if (typeof block.thinking === "string") return block.thinking;
      if (typeof block.content === "string") return block.content;
      return "";
    })
    .filter((value) => value.trim().length > 0)
    .join("");
  return text.trim();
}

function publishKiloTextUpdate(sessionId: string, text: string): void {
  if (!text.trim()) return;
  runtime.publishSessionEvent(sessionId, {
    type: "message.part.updated",
    properties: {
      part: {
        id: "kilo-text",
        type: "text",
        text,
      },
    },
  });
}

function publishKiloToolUpdate(params: {
  sessionId: string;
  id: string;
  tool: string;
  status: "pending" | "running" | "completed" | "error";
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
}): void {
  runtime.publishSessionEvent(params.sessionId, {
    type: "message.part.updated",
    properties: {
      part: {
        id: params.id,
        type: "tool",
        tool: params.tool,
        state: {
          status: params.status,
          ...(params.input ? { input: params.input } : {}),
          ...(params.output ? { output: params.output } : {}),
          ...(params.error ? { error: params.error } : {}),
        },
      },
    },
  });
}

function extractToolUses(record: KiloJsonRecord): Array<{ id: string; name: string; input?: Record<string, unknown> }> {
  const blocks = contentBlocks(record);
  const blockTools = blocks
    .filter((block) => block?.type === "tool_use")
    .map((block) => ({
      id: block.id || `kilo-tool-${Date.now()}`,
      name: block.name || "tool",
      input: block.input,
    }));
  const callTools = Array.isArray(record.tool_calls)
    ? record.tool_calls.map((call) => ({
      id: call.id || `kilo-tool-${Date.now()}`,
      name: call.function?.name || "tool",
      input: typeof call.function?.arguments === "object" && call.function?.arguments
        ? call.function?.arguments as Record<string, unknown>
        : undefined,
    }))
    : [];
  return [...blockTools, ...callTools];
}

function extractToolResults(record: KiloJsonRecord): Array<{ id: string; output?: string; error?: string; isError: boolean }> {
  const blocks = contentBlocks(record);
  return blocks
    .filter((block) => block?.type === "tool_result")
    .map((block) => ({
      id: block.tool_use_id || record.tool_call_id || "",
      output: typeof block.content === "string" ? block.content : undefined,
      error: block.is_error ? (typeof block.content === "string" ? block.content : "Tool failed") : undefined,
      isError: block.is_error === true,
    }))
    .filter((result) => result.id.length > 0);
}

async function runKiloCommand(
  args: string[],
  cwd: string,
  env: SessionEnvironment,
  entry: { controller: AbortController; process?: ChildProcess },
  onRecord?: (record: KiloJsonRecord) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveKiloBinary(), args, {
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
        onRecord(JSON.parse(trimmed) as KiloJsonRecord);
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
      reject(new Error("Kilo CLI timed out"));
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

      log.info("Kilo CLI completed", {
        code,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      if (code !== 0) {
        reject(new Error(stderr || `Kilo CLI exited with code ${code}`));
        return;
      }

      if (stderr) {
        log.warn("Kilo CLI stderr", { stderr });
      }

      resolve(stdout);
    });
  });
}

function extractKiloFinalResponse(output: string): string {
  const cleaned = sanitizeKiloOutput(output);
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const assistantMessages: string[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as KiloJsonRecord;
      const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
      const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
      if (role === "assistant" || type === "assistant" || type === "result") {
        const text = textFromContent(record);
        if (text) assistantMessages.push(text);
      }
    } catch {
      // ignore non-json lines
    }
  }

  const text = assistantMessages.join("\n\n").trim();
  return text || cleaned.trim();
}

export async function createSession(workingPath: string, env?: SessionEnvironment): Promise<string> {
  const sessionId = buildKiloSessionId();
  runtime.setSessionEnvironment(sessionId, env ?? {});
  newSessions.add(sessionId);
  log.info("Created Kilo session", { sessionId, workingPath });
  return sessionId;
}

export async function getOrCreateSession(
  channelId: string,
  threadId: string,
  workingPath: string,
  env: SessionEnvironment = {}
): Promise<OpenCodeSessionInfo> {
  const existingSession = getThreadSessionId(channelId, threadId, "kilo");
  if (existingSession) {
    if (!isValidKiloSessionId(existingSession)) {
      log.info("Invalid Kilo session id found; generating new session", {
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
      log.info("Kilo session environment changed; creating new session", {
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

  log.info("Creating new Kilo session for thread", { channelId, threadId, workingPath });
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
      const isNewSession = newSessions.has(sessionId);
      const parts = buildPromptParts(channelId, message, { ...options, agent }, context);
      const prompt = buildPromptText(parts);
      const systemPrompt = buildSystemPrompt(context?.slack);
      const kiloPrompt = `<system-prompt>\n${systemPrompt}\n</system-prompt>\n\n${prompt}`;

      const args = buildKiloCommandArgs({
        sessionId,
        prompt: kiloPrompt,
        agent,
        model: options?.model,
        isNewSession,
      });
      const command = buildKiloCommand(args);
      const envOverrides = runtime.getSessionEnvironment(sessionId);

      runtime.publishSessionEvent(sessionId, {
        type: "session.status",
        properties: {
          status: {
            type: "busy",
          },
        },
      });

      log.info("Running Kilo CLI", {
        cwd: workingPath,
        command,
      });

      let observedSessionId: string | null = null;
      const output = await runKiloCommand(args, workingPath, envOverrides, entry, (record) => {
        publishKiloRecordAsSessionEvents(record, sessionId);
        const recordSessionId = getRecordSessionId(record, sessionId);
        if (recordSessionId && recordSessionId !== sessionId) {
          observedSessionId = recordSessionId;
        }

        const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
        const type = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";
        if (role === "assistant" || type === "assistant") {
          const text = textFromContent(record);
          if (text) {
            publishKiloTextUpdate(recordSessionId, text);
          }
          for (const tool of extractToolUses(record)) {
            publishKiloToolUpdate({
              sessionId: recordSessionId,
              id: tool.id,
              tool: tool.name,
              status: "running",
              input: tool.input,
            });
          }
        }

        if (role === "tool" || type === "tool") {
          for (const result of extractToolResults(record)) {
            publishKiloToolUpdate({
              sessionId: recordSessionId,
              id: result.id,
              tool: "tool",
              status: result.isError ? "error" : "completed",
              output: result.output,
              error: result.error,
            });
          }
        }
      });

      if (observedSessionId && observedSessionId !== sessionId && context?.slack?.threadId) {
        runtime.setSessionEnvironment(observedSessionId, envOverrides);
        setThreadSessionId(channelId, context.slack.threadId, observedSessionId);
      }

      const text = extractKiloFinalResponse(output);
      if (!text) {
        throw new Error("Kilo returned empty response");
      }

      publishKiloTextUpdate(observedSessionId ?? sessionId, text);
      runtime.publishSessionEvent(observedSessionId ?? sessionId, {
        type: "session.status",
        properties: {
          status: {
            type: "idle",
          },
        },
      });
      if (!isNewSession || observedSessionId) {
        newSessions.delete(sessionId);
      }
      if (observedSessionId) {
        newSessions.delete(observedSessionId);
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
