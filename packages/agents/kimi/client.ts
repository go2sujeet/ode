import { log } from "@/utils";
import { buildPromptParts, buildPromptText, buildSystemPrompt, buildSystemWrappedPrompt } from "../shared";
import {
  CliAgentRuntime,
  formatShellCommand,
  noopStartServer,
  runCliJsonCommand,
  type SessionEnvironment as RuntimeSessionEnvironment,
} from "../runtime/base";
import { getOrCreateThreadSession } from "../runtime/thread-session";
import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "../types";

export type SessionEnvironment = RuntimeSessionEnvironment;

type KimiJsonRecord = {
  role?: string;
  content?: string | { type?: string; text?: string; think?: string } | Array<{ type?: string; text?: string; think?: string }>;
};

const runtime = new CliAgentRuntime("Kimi");

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

function publishKimiEvent(sessionId: string, record: KimiJsonRecord): void {
  const role = typeof record.role === "string" && record.role.trim() ? record.role.trim() : "unknown";
  runtime.publishSessionEvent(sessionId, {
    type: `kimi.raw.${role}`,
    properties: {
      record,
      role,
    },
  });
}

function contentToText(content: KimiJsonRecord["content"]): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return [content.text, content.think].filter((value): value is string => typeof value === "string").join("\n");
  }
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.think === "string") return part.think;
      return "";
    })
    .join("");
}

export function parseKimiResponse(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const assistantMessages: string[] = [];
  const fallbackMessages: string[] = [];
  const rawTextLines: string[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as KimiJsonRecord;
      const text = contentToText(record.content).trim();
      if (!text) continue;
      if (record.role === "assistant") {
        assistantMessages.push(text);
      } else {
        fallbackMessages.push(text);
      }
    } catch {
      if (!line.startsWith("{")) {
        rawTextLines.push(line);
      }
    }
  }

  const assistantText = assistantMessages.join("\n\n").trim();
  if (assistantText) return assistantText;

  const fallbackText = fallbackMessages.join("\n\n").trim();
  if (fallbackText) {
    log.warn("Kimi returned no assistant role output; using fallback text", {
      fallbackCount: fallbackMessages.length,
    });
    return fallbackText;
  }

  const rawText = rawTextLines.join("\n").trim();
  if (rawText) {
    log.warn("Kimi returned non-JSON output; using raw fallback text", {
      rawLineCount: rawTextLines.length,
    });
    return rawText;
  }

  log.warn("Kimi returned empty output; emitting placeholder response");
  return "Kimi completed without textual output.";
}

export async function createSession(workingPath: string, env?: SessionEnvironment): Promise<string> {
  const sessionId = crypto.randomUUID();
  runtime.setSessionEnvironment(sessionId, env ?? {});
  log.info("Created Kimi session", { sessionId, workingPath });
  return sessionId;
}

export async function getOrCreateSession(
  channelId: string,
  threadId: string,
  workingPath: string,
  env: SessionEnvironment = {}
): Promise<OpenCodeSessionInfo> {
  return getOrCreateThreadSession({
    channelId,
    threadId,
    providerId: "kimi",
    workingPath,
    env,
    createSession,
    getSessionEnvironment: (sessionId) => runtime.getSessionEnvironment(sessionId),
    setSessionEnvironment: (sessionId, nextEnv) => {
      runtime.setSessionEnvironment(sessionId, nextEnv);
    },
    onEnvironmentChanged: () => {
      log.info("Kimi session environment changed; creating new session", {
        channelId,
        threadId,
        workingPath,
      });
    },
    onCreatingSession: () => {
      log.info("Creating new Kimi session for thread", { channelId, threadId, workingPath });
    },
  });
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
  const entry = runtime.beginRequest(sessionKey);

  try {
    return await runtime.withSessionLock(sessionKey, async () => {
      const agent = options?.agent;
      const parts = buildPromptParts(channelId, message, { ...options, agent }, context);
      const prompt = buildPromptText(parts);
      const systemPrompt = buildKimiSystemPrompt(buildSystemPrompt(context?.slack), agent);
      const kimiPrompt = buildSystemWrappedPrompt(systemPrompt, prompt);

      const args = buildKimiCommandArgs({
        sessionId,
        workingPath,
        prompt: kimiPrompt,
      });
      const command = buildKimiCommand(args);
      const envOverrides = runtime.getSessionEnvironment(sessionId);

      log.info("Running Kimi CLI", {
        cwd: workingPath,
        command,
      });

      const output = await runCliJsonCommand<KimiJsonRecord>({
        providerName: "Kimi",
        binary: "kimi",
        args,
        cwd: workingPath,
        env: envOverrides,
        entry,
        timeoutMs: 10 * 60 * 1000,
        onRecord: (record) => {
          publishKimiEvent(sessionId, record);
        },
      });
      const text = parseKimiResponse(output);
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
