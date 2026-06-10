import { setThreadSessionId } from "@/config/local/sessions";
import { BoundedSet, log } from "@/utils";
import { buildPromptParts, buildPromptText, buildSystemPrompt, buildSystemWrappedPrompt } from "../shared";
import {
  CliAgentRuntime,
  formatShellCommand,
  noopStartServer,
  runCliJsonCommand,
  type SessionEnvironment as RuntimeSessionEnvironment,
} from "../runtime/base";
import { createCliThreadSessionManager } from "../runtime/cli-session";
import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
} from "../types";

export type SessionEnvironment = RuntimeSessionEnvironment;

type CodeBuddyContentBlock = {
  type?: string;
  text?: string;
};

export type CodeBuddyJsonRecord = {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  result?: string;
  is_error?: boolean;
  errors?: string[];
  message?: {
    role?: string;
    content?: CodeBuddyContentBlock[] | string;
    model?: string;
  };
  event?: {
    type?: string;
    index?: number;
    content_block?: Record<string, unknown>;
    delta?: Record<string, unknown>;
  };
};

const runtime = new CliAgentRuntime("CodeBuddy");
const NEW_SESSIONS_MAX_ENTRIES = 1000;
const newSessions = new BoundedSet<string>(NEW_SESSIONS_MAX_ENTRIES);
const DEFAULT_CODEBUDDY_MODEL = "gpt-5.1";

export const { createSession, getOrCreateSession } = createCliThreadSessionManager({
  providerId: "codebuddy",
  providerName: "CodeBuddy",
  runtime,
  newSessions,
});

function resolveCodeBuddyBinary(): string {
  if (typeof Bun !== "undefined") {
    if (Bun.which("codebuddy")) return "codebuddy";
    if (Bun.which("cbc")) return "cbc";
  }
  return "codebuddy";
}

function resolveCodeBuddyModel(model?: OpenCodeOptions["model"]): string {
  if (!model?.modelID) return DEFAULT_CODEBUDDY_MODEL;
  const providerID = model.providerID?.trim();
  if (providerID && providerID !== "codebuddy") return `${providerID}/${model.modelID}`;
  return model.modelID;
}

export function buildCodeBuddyCommandArgs(params: {
  sessionId: string;
  prompt: string;
  agent?: string;
  model?: OpenCodeOptions["model"];
}): string[] {
  return [
    "--print",
    params.prompt,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--session-id",
    params.sessionId,
    "--model",
    resolveCodeBuddyModel(params.model),
    "--permission-mode",
    params.agent?.trim().toLowerCase() === "plan" ? "plan" : "bypassPermissions",
    "--max-turns",
    "20",
    "--setting-sources",
    "user",
  ];
}

export function buildCodeBuddyCommand(args: string[]): string {
  return formatShellCommand([resolveCodeBuddyBinary(), ...args]);
}

function contentToText(content: CodeBuddyContentBlock[] | string | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

export function parseCodeBuddyResponse(output: string): string {
  let lastAssistantText = "";
  let resultText = "";
  let errorText = "";
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const record = JSON.parse(trimmed) as CodeBuddyJsonRecord;
      if (record.type === "assistant") {
        const text = contentToText(record.message?.content);
        if (text) lastAssistantText = text;
      }
      if (record.type === "result") {
        if (typeof record.result === "string" && record.result.trim()) {
          resultText = record.result.trim();
        }
        if (record.is_error) {
          errorText = record.errors?.join("\n") || resultText || "CodeBuddy reported an error";
        }
      }
    } catch {
      // ignore malformed lines
    }
  }
  if (errorText) throw new Error(errorText);
  return resultText || lastAssistantText || output.trim() || "CodeBuddy completed without textual output.";
}

function publishCodeBuddyRecord(record: CodeBuddyJsonRecord, fallbackSessionId: string): void {
  const sessionId = typeof record.session_id === "string" && record.session_id.trim()
    ? record.session_id
    : fallbackSessionId;
  const rawType = typeof record.type === "string" && record.type.trim() ? record.type.trim() : "unknown";
  const payload = {
    type: `codebuddy.raw.${rawType}`,
    properties: {
      record,
      recordType: rawType,
    },
  };
  runtime.publishSessionEvent(sessionId, payload);
  if (sessionId !== fallbackSessionId) {
    runtime.publishSessionEvent(fallbackSessionId, payload);
  }
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
      const codeBuddyPrompt = buildSystemWrappedPrompt(buildSystemPrompt(context?.slack), prompt);
      const envOverrides = runtime.getSessionEnvironment(sessionId);
      const args = buildCodeBuddyCommandArgs({
        sessionId,
        prompt: codeBuddyPrompt,
        agent,
        model: options?.model,
      });

      log.info("Running CodeBuddy CLI", {
        cwd: workingPath,
        command: buildCodeBuddyCommand(args),
      });

      const output = await runCliJsonCommand<CodeBuddyJsonRecord>({
        providerName: "CodeBuddy",
        binary: resolveCodeBuddyBinary(),
        args,
        cwd: workingPath,
        env: envOverrides,
        entry,
        onRecord: (record) => publishCodeBuddyRecord(record, sessionId),
      });

      if (newSessions.has(sessionId) && context?.slack?.threadId) {
        setThreadSessionId(channelId, context.slack.threadId, sessionId);
      }
      newSessions.delete(sessionId);

      return [{ text: parseCodeBuddyResponse(output), messageType: "assistant" }];
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
