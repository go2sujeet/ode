import { createAgentAdapter } from "@/agents/adapter";
import type { OpenCodeMessageContext } from "@/agents/types";
import * as Lark from "@larksuiteoapi/node-sdk";
import {
  getChannelSystemMessage,
  getGitHubInfoForUser,
  getLarkAppCredentials,
  getLarkTargetChannels,
  getUserGeneralSettings,
  parseStatusMessageFrequencyMs,
  setChannelAgentProvider,
  setChannelBaseBranch,
  setChannelModel,
  setChannelSystemMessage,
  setChannelWorkingDirectory,
  setGitHubInfoForUser,
  setUserGeneralSettings,
  type StatusMessageFormat,
  getWorkspaces,
} from "@/config";
import { findReplyThreadIdByStatusMessageTs } from "@/config/local/sessions";
import { isThreadActive, markThreadActive } from "@/config/local/settings";
import { createCoreRuntime } from "@/core/runtime";
import type { IMAdapter } from "@/core/types";
import { log } from "@/utils";
import { isStopCommand } from "@/ims/shared/stop-command";
import {
  toCoreMessageContext,
  type UnifiedMessageContext,
} from "@/ims/shared/message-context";
import { evaluateIncomingMessage } from "@/ims/shared/incoming-pipeline";
import { executeIncomingFlow } from "@/ims/shared/incoming-executor";
import { buildIncomingContext } from "@/ims/shared/incoming-normalizer";
import { parseIncomingCommand } from "@/ims/shared/command-router";
import { createRuntimeController } from "@/ims/shared/runtime-controller";
import {
  buildLarkSettingsDetailCard,
  resolveLarkSettingsCardAction,
  sendLarkSettingsCard,
} from "./settings";

let larkRuntimeStarted = false;

type LarkCredentials = {
  appId: string;
  appSecret: string;
};

type LarkMessageResponse = {
  message_id?: string;
};

type LarkMessageType = "text" | "interactive" | "post";

type LarkBotInfoResponse = {
  bot?: {
    open_id?: string;
  };
};

const tenantTokenCache = new Map<string, { token: string; expiresAt: number }>();
const botOpenIdCache = new Map<string, string>();
const sentMessageThreadMap = new Map<string, { channelId: string; threadId: string }>();
const larkMessageEditCounts = new Map<string, number>();
const wsClientRegistry = new Map<string, unknown>();
const MAX_LARK_MESSAGE_EDITS = 20;

function isLarkEventDebugEnabled(): boolean {
  const raw = process.env.LARK_DEBUG_EVENTS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function logLarkEvent(message: string, payload: Record<string, unknown>): void {
  if (!isLarkEventDebugEnabled()) return;
  log.debug(message, payload);
}

function getLarkCredentialsForChannel(channelId: string): LarkCredentials | null {
  const channel = channelId.trim();
  if (channel.length > 0) {
    for (const workspace of getWorkspaces()) {
      if (workspace.type !== "lark") continue;
      const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim() || "";
      const appSecret = workspace.larkAppSecret?.trim() ?? "";
      if (!appId || !appSecret) continue;
      if (workspace.channelDetails.some((entry) => entry.id === channel)) {
        return { appId, appSecret };
      }
    }
  }

  const first = getLarkAppCredentials()[0];
  if (!first) return null;
  return {
    appId: first.appId,
    appSecret: first.appSecret,
  };
}

async function getLarkTenantAccessToken(creds: LarkCredentials): Promise<string> {
  const cached = tenantTokenCache.get(creds.appId);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 30_000) {
    return cached.token;
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
  });
  if (!response.ok) {
    throw new Error(`Lark token API ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if ((payload.code ?? -1) !== 0 || !payload.tenant_access_token) {
    throw new Error(payload.msg || "Failed to get Lark tenant access token");
  }

  const ttlSec = typeof payload.expire === "number" ? payload.expire : 3600;
  tenantTokenCache.set(creds.appId, {
    token: payload.tenant_access_token,
    expiresAt: now + Math.max(ttlSec - 30, 30) * 1000,
  });
  return payload.tenant_access_token;
}

async function larkApi<T>(
  token: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://open.feishu.cn${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Lark API ${response.status} ${response.statusText}`);
  }
  const payload = await response.json() as {
    code?: number;
    msg?: string;
    data?: T;
    [key: string]: unknown;
  };
  if ((payload.code ?? -1) !== 0) {
    throw new Error(payload.msg || "Lark API error");
  }
  if (payload.data !== undefined) {
    return payload.data as T;
  }
  return payload as unknown as T;
}

async function sendLarkMessage(params: {
  channelId: string;
  threadId: string;
  msgType: LarkMessageType;
  content: Record<string, unknown>;
}): Promise<string | undefined> {
  const creds = getLarkCredentialsForChannel(params.channelId);
  if (!creds) {
    log.warn("No Lark credentials available for sendLarkMessage", { channelId: params.channelId });
    return undefined;
  }

  const token = await getLarkTenantAccessToken(creds);
  const data = params.threadId
    ? await larkApi<LarkMessageResponse>(
      token,
      "POST",
      `/open-apis/im/v1/messages/${encodeURIComponent(params.threadId)}/reply`,
      {
        msg_type: params.msgType,
        content: JSON.stringify(params.content),
        reply_in_thread: true,
      }
    )
    : await larkApi<LarkMessageResponse>(
      token,
      "POST",
      "/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        receive_id: params.channelId,
        msg_type: params.msgType,
        content: JSON.stringify(params.content),
      }
    );

  const messageId = data.message_id;
  if (messageId) {
    sentMessageThreadMap.set(messageId, {
      channelId: params.channelId,
      threadId: params.threadId,
    });
  }
  return messageId;
}

function buildLarkPostContent(text: string): Record<string, unknown> {
  const block = [{ tag: "md", text }];
  return {
    zh_cn: {
      title: "",
      content: [block],
    },
    en_us: {
      title: "",
      content: [block],
    },
  };
}

function stripLarkMentionMarkup(text: string): string {
  return text
    .replace(/<at\b[^>]*>.*?<\/at>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLarkText(content: string | undefined): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (typeof record.text === "string") {
        return record.text;
      }
      if (typeof record.content === "string") {
        return record.content;
      }
      const localized = (record.zh_cn ?? record.en_us) as Record<string, unknown> | undefined;
      const postBlocks = localized?.content;
      if (Array.isArray(postBlocks)) {
        const lines: string[] = [];
        for (const row of postBlocks) {
          if (!Array.isArray(row)) continue;
          const line = row
            .map((cell) => {
              if (!cell || typeof cell !== "object") return "";
              const textValue = (cell as Record<string, unknown>).text;
              return typeof textValue === "string" ? textValue : "";
            })
            .join("");
          if (line.trim()) lines.push(line);
        }
        if (lines.length > 0) return lines.join("\n");
      }
    }
    return content;
  } catch {
    return content;
  }
}

async function buildLarkContext(
  channelId: string,
  threadId: string,
  userId: string,
  threadHistory?: string | null
): Promise<OpenCodeMessageContext> {
  return {
    threadHistory: threadHistory || undefined,
    slack: {
      platform: "lark",
      channelId,
      threadId,
      userId,
      threadHistory: threadHistory || undefined,
      hasCustomSlackTool: false,
      hasGitHubToken: Boolean(getGitHubInfoForUser(userId)?.token),
      channelSystemMessage: getChannelSystemMessage(channelId) ?? undefined,
    },
  };
}

async function sendMessage(
  channelId: string,
  threadId: string,
  text: string
): Promise<string | undefined> {
  return sendLarkMessage({
    channelId,
    threadId: threadId || "",
    msgType: "post",
    content: buildLarkPostContent(text),
  });
}

async function sendSettingsCard(channelId: string, threadId: string): Promise<string | undefined> {
  return sendLarkSettingsCard({
    channelId,
    threadId,
    sendInteractive: (card) =>
      sendLarkMessage({
        channelId,
        threadId,
        msgType: "interactive",
        content: card,
      }),
    sendText: (text) => sendMessage(channelId, threadId, text),
    logEvent: logLarkEvent,
  });
}

async function updateMessage(
  channelId: string,
  messageId: string,
  text: string
): Promise<string | undefined> {
  const creds = getLarkCredentialsForChannel(channelId);
  if (!creds) return;
  const token = await getLarkTenantAccessToken(creds);

  const editCount = larkMessageEditCounts.get(messageId) ?? 0;
  if (editCount >= MAX_LARK_MESSAGE_EDITS) {
    const trackedThreadId = sentMessageThreadMap.get(messageId)?.threadId || findReplyThreadIdByStatusMessageTs(messageId) || "";
    try {
      await deleteMessage(channelId, messageId);
      const replacementMessageId = await sendMessage(channelId, trackedThreadId, text);
      if (replacementMessageId) {
        larkMessageEditCounts.delete(messageId);
        larkMessageEditCounts.set(replacementMessageId, 0);
        log.info("Lark message edit limit reached; replaced status message", {
          channelId,
          oldMessageId: messageId,
          newMessageId: replacementMessageId,
          editCount,
        });
        return replacementMessageId;
      }
      log.warn("Lark message edit limit reached but replacement send failed", {
        channelId,
        messageId,
        editCount,
      });
    } catch (error) {
      log.warn("Failed to replace Lark message after edit limit reached", {
        channelId,
        messageId,
        editCount,
        error: String(error),
      });
    }
  }

  const payload = {
    msg_type: "post",
    content: JSON.stringify(buildLarkPostContent(text)),
  };

  try {
    await larkApi<Record<string, unknown>>(
      token,
      "PATCH",
      `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
      payload
    );
    larkMessageEditCounts.set(messageId, editCount + 1);
    return;
  } catch (error) {
    const patchMessage = error instanceof Error ? error.message : String(error);
    const patchNormalized = patchMessage.toLowerCase();
    if (patchNormalized.includes("429") || patchNormalized.includes("rate limit") || patchNormalized.includes("ratelimit")) {
      log.warn("Lark message update rate limited", {
        channelId,
        messageId,
        error: patchMessage,
      });
      throw error;
    }
    if (!patchMessage.includes("400")) {
      log.warn("Failed to update Lark message", {
        channelId,
        messageId,
        error: patchMessage,
      });
      return;
    }

    try {
      await larkApi<Record<string, unknown>>(
        token,
        "PUT",
        `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
        payload
      );
      larkMessageEditCounts.set(messageId, editCount + 1);
      return;
    } catch (fallbackError) {
      const fallbackMessage = String(fallbackError);
      const fallbackNormalized = fallbackMessage.toLowerCase();
      if (fallbackNormalized.includes("429") || fallbackNormalized.includes("rate limit") || fallbackNormalized.includes("ratelimit")) {
        log.warn("Lark message update fallback rate limited", {
          channelId,
          messageId,
          error: fallbackMessage,
        });
        throw fallbackError;
      }
      log.warn("Failed to update Lark message with PATCH/POST fallback", {
        channelId,
        messageId,
        error: fallbackMessage,
      });
    }

    log.warn("Failed to update Lark message", {
      channelId,
      messageId,
      error: patchMessage,
    });
  }
}

async function deleteMessage(channelId: string, messageId: string): Promise<void> {
  const creds = getLarkCredentialsForChannel(channelId);
  if (!creds) return;
  const token = await getLarkTenantAccessToken(creds);
  try {
    await larkApi<Record<string, unknown>>(
      token,
      "DELETE",
      `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`
    );
    sentMessageThreadMap.delete(messageId);
    larkMessageEditCounts.delete(messageId);
  } catch {
    // Ignore delete failures
  }
}

async function fetchThreadHistory(
  channelId: string,
  threadId: string,
  messageId: string
): Promise<string | null> {
  const creds = getLarkCredentialsForChannel(channelId);
  if (!creds) return null;
  const token = await getLarkTenantAccessToken(creds);
  try {
    let threadConversationId = "";
    try {
      const rootData = await larkApi<{ items?: Array<Record<string, unknown>> }>(
        token,
        "GET",
        `/open-apis/im/v1/messages/${encodeURIComponent(threadId)}`
      );
      const rootItem = Array.isArray(rootData.items) ? rootData.items[0] : null;
      threadConversationId = typeof rootItem?.thread_id === "string" ? rootItem.thread_id : "";
    } catch {
      threadConversationId = "";
    }

    const data = await larkApi<{ items?: Array<Record<string, unknown>> }>(
      token,
      "GET",
      `/open-apis/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(channelId)}&page_size=50`
    );
    const lines = (data.items ?? [])
      .filter((message) => {
        const messageId = typeof message.message_id === "string" ? message.message_id : "";
        const rootId = typeof message.root_id === "string" ? message.root_id : "";
        const parentId = typeof message.parent_id === "string" ? message.parent_id : "";
        const itemThreadId = typeof message.thread_id === "string" ? message.thread_id : "";
        if (threadConversationId) {
          return itemThreadId === threadConversationId;
        }
        return messageId === threadId || rootId === threadId || parentId === threadId;
      })
      .filter((message) => {
        const currentMessageId = typeof message.message_id === "string" ? message.message_id : "";
        return currentMessageId && currentMessageId !== messageId;
      })
      .map((message) => {
        const sender = (message.sender as Record<string, unknown> | undefined)?.sender_id as Record<string, unknown> | undefined;
        const author = typeof sender?.open_id === "string" ? sender.open_id : "unknown";
        const body = message.body as Record<string, unknown> | undefined;
        const text = parseLarkText(typeof body?.content === "string" ? body.content : undefined);
        return text ? `${author}: ${text}` : "";
      })
      .filter((line) => line.trim().length > 0);
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

const larkAdapter: IMAdapter = {
  maxEditableMessageChars: 30_000,
  sendMessage,
  updateMessage,
  deleteMessage,
  fetchThreadHistory,
  buildAgentContext: async ({ channelId, threadId, userId, threadHistory }) =>
    buildLarkContext(channelId, threadId, userId, threadHistory),
};

const coreRuntime = createCoreRuntime({
  platform: "lark",
  im: larkAdapter,
  agent: createAgentAdapter(),
});

async function getBotOpenIdForChannel(channelId: string): Promise<string | null> {
  const creds = getLarkCredentialsForChannel(channelId);
  if (!creds) return null;
  const cached = botOpenIdCache.get(creds.appId);
  if (cached) return cached;
  const token = await getLarkTenantAccessToken(creds);
  const data = await larkApi<LarkBotInfoResponse>(token, "GET", "/open-apis/bot/v3/info");
  const openId = data.bot?.open_id?.trim();
  if (openId) {
    botOpenIdCache.set(creds.appId, openId);
    return openId;
  }
  logLarkEvent("Lark bot open_id missing from bot/v3/info response", {
    channelId,
    appId: creds.appId,
    responseKeys: Object.keys((data as Record<string, unknown>) ?? {}),
  });
  return null;
}

function isAuthorizedLarkChannel(channelId: string): boolean {
  const targets = getLarkTargetChannels();
  if (!targets) return true;
  return targets.includes(channelId);
}

function parseMentionedOpenIds(mentions: unknown): string[] {
  if (!Array.isArray(mentions)) return [];
  const ids: string[] = [];
  for (const mention of mentions) {
    if (!mention || typeof mention !== "object") continue;
    const record = mention as Record<string, unknown>;

    const directOpenId = record.open_id;
    if (typeof directOpenId === "string" && directOpenId.trim().length > 0) {
      ids.push(directOpenId.trim());
    }

    const directUserId = record.user_id;
    if (typeof directUserId === "string" && directUserId.trim().length > 0) {
      ids.push(directUserId.trim());
    }

    const directKey = record.key;
    if (typeof directKey === "string" && directKey.trim().length > 0) {
      ids.push(directKey.trim());
    }

    const idValue = record.id;
    if (typeof idValue === "string" && idValue.trim().length > 0) {
      ids.push(idValue.trim());
      continue;
    }

    const idRecord = idValue;
    if (!idRecord || typeof idRecord !== "object") continue;
    const openId = (idRecord as Record<string, unknown>).open_id;
    if (typeof openId === "string" && openId.trim().length > 0) {
      ids.push(openId.trim());
    }

    const userId = (idRecord as Record<string, unknown>).user_id;
    if (typeof userId === "string" && userId.trim().length > 0) {
      ids.push(userId.trim());
    }
  }
  return Array.from(new Set(ids));
}

function isBotMentionedInText(rawText: string, botOpenId: string): boolean {
  if (!rawText || !botOpenId) return false;
  const escaped = botOpenId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<at\\b[^>]*(?:open_id|user_id|id)\\s*=\\s*"${escaped}"[^>]*>`, "i");
  return pattern.test(rawText);
}

type LarkIncomingEnvelope = {
  type?: string;
  challenge?: string;
  header?: {
    event_type?: string;
  };
  event?: {
    sender?: {
      sender_id?: {
        open_id?: string;
      };
    };
    message?: {
      chat_id?: string;
      message_id?: string;
      root_id?: string;
      parent_id?: string;
      message_type?: string;
      content?: string;
      mentions?: unknown;
    };
  };
};

type LarkCardActionEnvelope = {
  action?: {
    value?: unknown;
  };
  open_chat_id?: string;
  chat_id?: string;
  open_message_id?: string;
  message_id?: string;
  open_id?: string;
  user_id?: string;
  event?: {
    action?: {
      value?: unknown;
    };
    context?: {
      open_chat_id?: string;
      chat_id?: string;
      open_message_id?: string;
      message_id?: string;
    };
    operator?: {
      open_id?: string;
      user_id?: string;
    };
  };
};

type LarkIncomingEvent = NonNullable<LarkIncomingEnvelope["event"]>;

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = toTrimmedString(value);
    if (normalized.length > 0) return normalized;
  }
  return "";
}

function pickValueField(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return firstNonEmptyString(record[key], record[key.replace(/_([a-z])/g, (_, s) => s.toUpperCase())]);
}

function pickActionSelectedOption(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  const event = root.event && typeof root.event === "object" ? root.event as Record<string, unknown> : null;
  const action = event?.action && typeof event.action === "object" ? event.action as Record<string, unknown> : null;
  const option = action?.option && typeof action.option === "object" ? action.option as Record<string, unknown> : null;
  const options = action?.options && Array.isArray(action.options) ? action.options as unknown[] : [];

  const fromOption = firstNonEmptyString(option?.value);
  if (fromOption) return fromOption;

  for (const item of options) {
    if (!item || typeof item !== "object") continue;
    const value = firstNonEmptyString((item as Record<string, unknown>).value);
    if (value) return value;
  }

  return "";
}

function extractFormValues(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object") return {};
  const root = payload as Record<string, unknown>;
  const event = root.event && typeof root.event === "object" ? root.event as Record<string, unknown> : null;
  const action = event?.action && typeof event.action === "object" ? event.action as Record<string, unknown> : null;
  const form = action?.form_value && typeof action.form_value === "object"
    ? action.form_value as Record<string, unknown>
    : root.form_value && typeof root.form_value === "object"
      ? root.form_value as Record<string, unknown>
      : {};
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const directValue = firstNonEmptyString(record.value);
    if (directValue) {
      normalized[key] = directValue;
      continue;
    }
    const option = record.option && typeof record.option === "object" ? record.option as Record<string, unknown> : null;
    const optionValue = firstNonEmptyString(option?.value);
    if (optionValue) {
      normalized[key] = optionValue;
      continue;
    }
    const options = Array.isArray(record.options) ? record.options : [];
    for (const item of options) {
      if (!item || typeof item !== "object") continue;
      const itemValue = firstNonEmptyString((item as Record<string, unknown>).value);
      if (itemValue) {
        normalized[key] = itemValue;
        break;
      }
    }
  }
  return normalized;
}

function pickFormValue(
  formValues: Record<string, string>,
  key: string
): { exists: boolean; value: string } {
  if (Object.prototype.hasOwnProperty.call(formValues, key)) {
    return {
      exists: true,
      value: formValues[key] ?? "",
    };
  }
  return {
    exists: false,
    value: "",
  };
}

async function processLarkCardAction(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const envelope = payload as LarkCardActionEnvelope;
  const value = envelope.event?.action?.value ?? envelope.action?.value;
  const action = resolveLarkSettingsCardAction(value);
  if (!action) return;

  const channelId = firstNonEmptyString(
    envelope.event?.context?.open_chat_id,
    envelope.event?.context?.chat_id,
    envelope.open_chat_id,
    envelope.chat_id,
    pickValueField(value, "channel_id"),
    pickValueField(value, "channelId")
  );
  const sourceMessageId = firstNonEmptyString(
    envelope.event?.context?.open_message_id,
    envelope.event?.context?.message_id,
    envelope.open_message_id,
    envelope.message_id
  );
  const threadId = firstNonEmptyString(
    pickValueField(value, "thread_id"),
    pickValueField(value, "threadId"),
    sourceMessageId
  );
  const userId = firstNonEmptyString(
    envelope.event?.operator?.open_id,
    envelope.event?.operator?.user_id,
    envelope.open_id,
    envelope.user_id
  );

  if (
    action === "set_general_status_format"
    || action === "set_general_status_frequency"
    || action === "set_general_git_strategy"
    || action === "set_general_auto_update"
  ) {
    const current = getUserGeneralSettings();
    if (action === "set_general_status_format") {
      const format = firstNonEmptyString(
        pickValueField(value, "status_format"),
        pickValueField(value, "statusFormat"),
        pickActionSelectedOption(payload)
      );
      if (format === "minimum" || format === "medium" || format === "aggressive") {
        current.defaultStatusMessageFormat = format as StatusMessageFormat;
      }
    } else if (action === "set_general_status_frequency") {
      const raw = firstNonEmptyString(
        pickValueField(value, "status_frequency_ms"),
        pickValueField(value, "statusFrequencyMs"),
        pickActionSelectedOption(payload)
      );
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        current.statusMessageFrequencyMs = parseStatusMessageFrequencyMs(parsed);
      }
    } else if (action === "set_general_git_strategy") {
      const strategy = firstNonEmptyString(
        pickValueField(value, "git_strategy"),
        pickValueField(value, "gitStrategy"),
        pickActionSelectedOption(payload)
      );
      current.gitStrategy = strategy === "default" ? "default" : "worktree";
    } else if (action === "set_general_auto_update") {
      const autoUpdate = firstNonEmptyString(
        pickValueField(value, "auto_update"),
        pickValueField(value, "autoUpdate"),
        pickActionSelectedOption(payload)
      ).toLowerCase();
      current.autoUpdate = !(autoUpdate === "off" || autoUpdate === "false" || autoUpdate === "0");
    }
    setUserGeneralSettings(current);
  }

  if (action === "set_channel_settings") {
    const formValues = extractFormValues(payload);
    const selected = pickActionSelectedOption(payload);
    const field = firstNonEmptyString(
      pickValueField(value, "field")
    );
    const formModel = pickFormValue(formValues, "model");
    const formWorkingDirectory = pickFormValue(formValues, "workingDirectory");
    const formBaseBranch = pickFormValue(formValues, "baseBranch");
    const formSystemMessage = pickFormValue(formValues, "channelSystemMessage");
    const provider = firstNonEmptyString(
      pickValueField(value, "provider"),
      field === "provider" ? selected : ""
    );
    if (
      provider === "opencode"
      || provider === "claudecode"
      || provider === "codex"
      || provider === "kimi"
      || provider === "kiro"
      || provider === "kilo"
      || provider === "qwen"
      || provider === "goose"
      || provider === "gemini"
    ) {
      setChannelAgentProvider(channelId, provider);
    }

    const model = formModel.exists
      ? formModel.value
      : firstNonEmptyString(
        pickValueField(value, "model"),
        field === "model" ? selected : ""
      );
    setChannelModel(channelId, model);

    const workingDirectory = formWorkingDirectory.exists
      ? formWorkingDirectory.value
      : firstNonEmptyString(
        pickValueField(value, "working_directory"),
        pickValueField(value, "workingDirectory"),
        field === "workingDirectory" ? selected : ""
      );
    setChannelWorkingDirectory(channelId, workingDirectory || null);

    const baseBranch = formBaseBranch.exists
      ? formBaseBranch.value
      : firstNonEmptyString(
        pickValueField(value, "base_branch"),
        pickValueField(value, "baseBranch"),
        field === "baseBranch" ? selected : ""
      );
    setChannelBaseBranch(channelId, baseBranch || null);

    const channelSystemMessage = formSystemMessage.exists
      ? formSystemMessage.value
      : firstNonEmptyString(
        pickValueField(value, "channel_system_message"),
        pickValueField(value, "channelSystemMessage"),
        field === "channelSystemMessage" ? selected : ""
      );
    setChannelSystemMessage(channelId, channelSystemMessage || null);
  }

  if (action === "set_github_info") {
    const formValues = extractFormValues(payload);
    const selected = pickActionSelectedOption(payload);
    const field = firstNonEmptyString(pickValueField(value, "field"));
    const formGithubToken = pickFormValue(formValues, "githubToken");
    const formGithubName = pickFormValue(formValues, "githubName");
    const formGithubEmail = pickFormValue(formValues, "githubEmail");
    const token = formGithubToken.exists
      ? formGithubToken.value
      : firstNonEmptyString(
        pickValueField(value, "github_token"),
        pickValueField(value, "githubToken"),
        field === "githubToken" ? selected : ""
      );
    const gitName = formGithubName.exists
      ? formGithubName.value
      : firstNonEmptyString(
        pickValueField(value, "git_name"),
        pickValueField(value, "github_name"),
        pickValueField(value, "gitName"),
        pickValueField(value, "githubName"),
        field === "githubName" ? selected : ""
      );
    const gitEmail = formGithubEmail.exists
      ? formGithubEmail.value
      : firstNonEmptyString(
        pickValueField(value, "git_email"),
        pickValueField(value, "github_email"),
        pickValueField(value, "gitEmail"),
        pickValueField(value, "githubEmail"),
        field === "githubEmail" ? selected : ""
      );
    setGitHubInfoForUser(userId || "", {
      token,
      gitName,
      gitEmail,
    });
  }

  if (action === "clear_github_info") {
    setGitHubInfoForUser(userId || "", {
      token: "",
      gitName: "",
      gitEmail: "",
    });
  }

  if (!channelId || !threadId) {
    logLarkEvent("Lark card action ignored: missing routing ids", {
      channelId,
      threadId,
      sourceMessageId,
      action,
    });
    return;
  }

  const card = action === "open_settings_launcher"
    ? null
    : buildLarkSettingsDetailCard({
      action: (
        action === "set_general_status_format"
        || action === "set_general_status_frequency"
        || action === "set_general_git_strategy"
        || action === "set_general_auto_update"
        || action === "set_channel_settings"
        || action === "set_github_info"
        || action === "clear_github_info"
      )
        ? (
          action === "set_channel_settings"
            ? "open_settings_modal"
            : action === "set_github_info" || action === "clear_github_info"
              ? "open_github_token_modal"
              : "open_general_settings_modal"
        )
        : action,
      channelId,
      threadId,
      userId: userId || "",
      notice: (
        action === "set_general_status_format"
        || action === "set_general_status_frequency"
        || action === "set_general_git_strategy"
        || action === "set_general_auto_update"
        || action === "set_channel_settings"
        || action === "set_github_info"
        || action === "clear_github_info"
      )
        ? (
          action === "set_channel_settings"
            ? "Channel settings updated"
            : action === "set_github_info"
              ? "GitHub settings updated"
              : action === "clear_github_info"
                ? "GitHub settings cleared"
                : "General settings updated"
        )
        : undefined,
    });

  if (!card) {
    await sendSettingsCard(channelId, threadId);
    return;
  }

  await sendLarkMessage({
    channelId,
    threadId,
    msgType: "interactive",
    content: card,
  });
}

function isLarkLongConnectionEnabled(): boolean {
  const raw = process.env.LARK_LONG_CONNECTION?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
}

function isTopLevelMessage(message: LarkIncomingEvent["message"]): boolean {
  return !(message?.root_id || message?.parent_id);
}

async function processLarkIncomingEvent(event: LarkIncomingEvent): Promise<void> {
  const message = event.message;
  const senderOpenId = event.sender?.sender_id?.open_id?.trim() || "";
  const channelId = message?.chat_id?.trim() || "";
  const messageId = message?.message_id?.trim() || "";
  const threadId = message?.root_id?.trim() || message?.parent_id?.trim() || messageId;
  const topLevelMessage = isTopLevelMessage(message);

  logLarkEvent("Lark inbound event received", {
    channelId,
    messageId,
    threadId,
    senderOpenId,
    messageType: message?.message_type ?? "",
    isThreadReply: !topLevelMessage,
    hasMentions: Array.isArray(message?.mentions),
  });

  if (!channelId || !messageId || !threadId || !senderOpenId) {
    logLarkEvent("Lark inbound ignored: missing required identifiers", {
      channelId,
      messageId,
      threadId,
      senderOpenId,
    });
    return;
  }

  if (!isAuthorizedLarkChannel(channelId)) {
    logLarkEvent("Lark inbound ignored: channel not authorized", { channelId });
    return;
  }

  const botOpenId = await getBotOpenIdForChannel(channelId);
  if (!topLevelMessage && botOpenId && senderOpenId === botOpenId) {
    logLarkEvent("Lark inbound ignored: self message", {
      channelId,
      messageId,
      senderOpenId,
      botOpenId,
    });
    return;
  }

  if (message?.message_type !== "text") {
    logLarkEvent("Lark inbound ignored: non-text message", {
      channelId,
      messageId,
      messageType: message?.message_type ?? "",
    });
    return;
  }

  const rawText = parseLarkText(message?.content);
  const mentions = parseMentionedOpenIds(message?.mentions);
  const isMentioned = botOpenId
    ? (mentions.includes(botOpenId) || isBotMentionedInText(rawText, botOpenId))
    : false;
  const active = isThreadActive(channelId, threadId);
  const text = stripLarkMentionMarkup(rawText);
  const messageContext: UnifiedMessageContext = buildIncomingContext({
    platform: "lark",
    channelId,
    threadId,
    messageId,
    userId: senderOpenId,
    isTopLevel: topLevelMessage,
    mentionedBot: isMentioned,
    activeThread: active,
    rawText,
    normalizedText: text,
  });

  logLarkEvent("Lark inbound parsed", {
    channelId,
    messageId,
    botOpenId: botOpenId ?? "",
    rawText,
    mentions,
    mentionCount: mentions.length,
    isMentioned,
    activeThread: active,
    textLength: text.length,
  });

  const command = parseIncomingCommand(text);
  if (command === "setting") {
    logLarkEvent("Lark inbound matched /setting", {
      channelId,
      threadId,
      messageId,
      topLevelMessage,
      isMentioned,
    });
    await sendSettingsCard(channelId, threadId);
    return;
  }

  const flowResult = evaluateIncomingMessage(messageContext, isStopCommand);
  await executeIncomingFlow({
    context: messageContext,
    flowResult,
    markThreadActive,
    handleStopCommand: (flowChannelId, flowThreadId) => coreRuntime.handleStopCommand(flowChannelId, flowThreadId),
    sendStopAck: async () => {
      await sendMessage(channelId, threadId, "Request stopped.");
    },
    onIgnore: (reason) => {
      if (reason === "not_mentioned_and_inactive") {
        logLarkEvent("Lark inbound ignored: not mentioned and thread inactive", {
          channelId,
          threadId,
          messageId,
          reason,
          isTopLevel: topLevelMessage,
          isMentioned,
          activeThread: active,
        });
        return;
      }
      logLarkEvent("Lark inbound ignored: empty text after mention stripping", {
        channelId,
        messageId,
      });
    },
    forwardToCore: async (forwardText) => {
      logLarkEvent("Lark inbound accepted: forwarding to core runtime", {
        channelId,
        threadId,
        messageId,
        userId: senderOpenId,
      });
      await coreRuntime.handleIncomingMessage(
        toCoreMessageContext(messageContext),
        forwardText
      );
      logLarkEvent("Lark inbound handled by core runtime", {
        channelId,
        threadId,
        messageId,
      });
    },
  });
}

async function startLarkLongConnections(reason: string): Promise<void> {
  if (!isLarkLongConnectionEnabled()) {
    log.debug("Lark long connection disabled", { reason });
    return;
  }

  const workspaces = getLarkAppCredentials();
  const uniqueCredentials = new Map<string, { appId: string; appSecret: string }>();
  for (const workspace of workspaces) {
    if (!uniqueCredentials.has(workspace.appId)) {
      uniqueCredentials.set(workspace.appId, {
        appId: workspace.appId,
        appSecret: workspace.appSecret,
      });
    }
  }

  for (const [appId, creds] of uniqueCredentials.entries()) {
    if (wsClientRegistry.has(appId)) {
      continue;
    }

    const eventDispatcher = new Lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (data: unknown) => {
        try {
          await processLarkIncomingEvent(data as LarkIncomingEvent);
        } catch (error) {
          log.warn("Failed to handle Lark long-connection message event", {
            appId,
            error: String(error),
          });
        }
      },
      "card.action.trigger": async (data: unknown) => {
        try {
          await processLarkCardAction(data);
        } catch (error) {
          log.warn("Failed to handle Lark long-connection card action", {
            appId,
            error: String(error),
          });
        }
      },
    });

    const wsClient = new Lark.WSClient({
      appId: creds.appId,
      appSecret: creds.appSecret,
      loggerLevel: Lark.LoggerLevel.debug,
    });

    await Promise.resolve(
      wsClient.start({
        eventDispatcher,
      })
    );

    wsClientRegistry.set(appId, wsClient);
    log.debug("Lark long connection started", { appId });
  }
}

async function stopLarkLongConnections(reason: string): Promise<void> {
  const entries = Array.from(wsClientRegistry.entries());
  wsClientRegistry.clear();
  for (const [appId, client] of entries) {
    try {
      const wsClient = client as { stop?: () => unknown | Promise<unknown> };
      if (typeof wsClient.stop === "function") {
        await Promise.resolve(wsClient.stop());
      }
      log.debug("Lark long connection stopped", { appId, reason });
    } catch (error) {
      log.warn("Failed to stop Lark long connection", {
        appId,
        reason,
        error: String(error),
      });
    }
  }
}

export async function handleLarkEventPayload(payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!payload || typeof payload !== "object") {
    logLarkEvent("Lark webhook ignored: invalid payload", {});
    return { status: 400, body: { ok: false, error: "Invalid payload" } };
  }

  const envelope = payload as LarkIncomingEnvelope;
  if (envelope.type === "url_verification" && typeof envelope.challenge === "string") {
    logLarkEvent("Lark webhook url_verification", {});
    return { status: 200, body: { challenge: envelope.challenge } };
  }

  const payloadRecord = payload as Record<string, unknown>;
  const payloadEvent = payloadRecord.event && typeof payloadRecord.event === "object"
    ? payloadRecord.event as Record<string, unknown>
    : null;
  const payloadEventAction = payloadEvent?.action && typeof payloadEvent.action === "object"
    ? payloadEvent.action as Record<string, unknown>
    : null;
  const payloadAction = payloadRecord.action && typeof payloadRecord.action === "object"
    ? payloadRecord.action as Record<string, unknown>
    : null;
  const cardAction = resolveLarkSettingsCardAction(payloadEventAction?.value)
    || resolveLarkSettingsCardAction(payloadAction?.value)
    || resolveLarkSettingsCardAction(payloadEventAction)
    || resolveLarkSettingsCardAction(payloadAction);
  if (cardAction) {
    await processLarkCardAction(payload);
    return { status: 200, body: { code: 0 } };
  }

  if (envelope.header?.event_type !== "im.message.receive_v1") {
    if (envelope.header?.event_type === "card.action.trigger") {
      await processLarkCardAction(payload);
      return {
        status: 200,
        body: { code: 0 },
      };
    }

    logLarkEvent("Lark webhook ignored: unsupported event type", {
      eventType: envelope.header?.event_type ?? "",
    });
    return { status: 200, body: { code: 0 } };
  }

  if (envelope.event) {
    await processLarkIncomingEvent(envelope.event);
  }

  return { status: 200, body: { code: 0 } };
}

export async function startLarkRuntime(reason: string): Promise<boolean> {
  if (larkRuntimeStarted) {
    log.debug("Lark runtime start skipped; already running", { reason });
  }
  return larkRuntimeController.start(reason);
}

export async function stopLarkRuntime(reason: string): Promise<void> {
  await larkRuntimeController.stop(reason);
}

const larkRuntimeController = createRuntimeController({
  isRunning: () => larkRuntimeStarted,
  startInternal: async (reason: string): Promise<boolean> => {
    const workspaces = getLarkAppCredentials();
    if (workspaces.length === 0) {
      log.debug("Lark runtime skipped (Lark app credentials missing)", { reason });
      return false;
    }
    larkRuntimeStarted = true;
    tenantTokenCache.clear();
    botOpenIdCache.clear();
    sentMessageThreadMap.clear();
    log.debug("Lark runtime started", {
      reason,
      workspaceCount: workspaces.length,
    });
    await startLarkLongConnections(reason);
    return true;
  },
  stopInternal: async (reason: string): Promise<void> => {
    larkRuntimeStarted = false;
    await stopLarkLongConnections(reason);
    tenantTokenCache.clear();
    botOpenIdCache.clear();
    sentMessageThreadMap.clear();
    log.debug("Lark runtime stopped", { reason });
  },
});

export const recoverPendingRequests = coreRuntime.recoverPendingRequests;
