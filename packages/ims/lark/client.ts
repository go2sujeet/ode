import { createAgentAdapter } from "@/agents/adapter";
import type { OpenCodeMessageContext } from "@/agents/types";
import * as Lark from "@larksuiteoapi/node-sdk";
import {
  getChannelSystemMessage,
  getGitHubInfoForUser,
  getLarkAppCredentials,
  getLarkTargetChannels,
  getWebHost,
  getWebPort,
  getWorkspaces,
} from "@/config";
import { isThreadActive, markThreadActive } from "@/config/local/settings";
import { createCoreRuntime } from "@/core/runtime";
import type { IMAdapter } from "@/core/types";
import { log } from "@/utils";

let larkRuntimeStarted = false;

type LarkCredentials = {
  appId: string;
  appSecret: string;
};

type LarkMessageResponse = {
  message_id?: string;
};

type LarkMessageType = "text" | "interactive";

type LarkBotInfoResponse = {
  bot?: {
    open_id?: string;
  };
};

const tenantTokenCache = new Map<string, { token: string; expiresAt: number }>();
const botOpenIdCache = new Map<string, string>();
const sentMessageThreadMap = new Map<string, { channelId: string; threadId: string }>();
const wsClientRegistry = new Map<string, unknown>();

function isLarkEventDebugEnabled(): boolean {
  const raw = process.env.LARK_DEBUG_EVENTS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function logLarkEvent(message: string, payload: Record<string, unknown>): void {
  if (!isLarkEventDebugEnabled()) return;
  log.info(message, payload);
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
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
  };
  if ((payload.code ?? -1) !== 0) {
    throw new Error(payload.msg || "Lark API error");
  }
  return (payload.data ?? ({} as T)) as T;
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

function stripLarkMentionMarkup(text: string): string {
  return text
    .replace(/<at\b[^>]*>.*?<\/at>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLarkText(content: string | undefined): string {
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

function isStopCommand(text: string): boolean {
  return text.trim().toLowerCase() === "stop";
}

function isSettingsCommand(text: string): boolean {
  return /^\/setting\b/i.test(text.trim());
}

function getLocalSettingsUrl(): string {
  return `http://${getWebHost()}:${getWebPort()}/local-setting`;
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
  text: string,
  _asMarkdown = true
): Promise<string | undefined> {
  const isThreadMessage = Boolean(threadId && isThreadActive(channelId, threadId));
  return sendLarkMessage({
    channelId,
    threadId: isThreadMessage ? threadId : "",
    msgType: "text",
    content: { text },
  });
}

async function sendSettingsCard(channelId: string, threadId: string): Promise<string | undefined> {
  const settingsUrl = getLocalSettingsUrl();
  const card = {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: "Ode Settings",
      },
    },
    elements: [
      {
        tag: "markdown",
        content: `Configure this chat in the local settings UI.\\n\\nChannel: \`${channelId}\``,
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "Open Local Setting",
            },
            type: "primary",
            url: settingsUrl,
          },
        ],
      },
    ],
  };

  try {
    return await sendLarkMessage({
      channelId,
      threadId,
      msgType: "interactive",
      content: card as unknown as Record<string, unknown>,
    });
  } catch {
    const fallbackText = [
      "Ode settings",
      `Open: ${settingsUrl}`,
      `Channel: ${channelId}`,
      "Use this channel in Local Setting to configure provider/model/directory.",
    ].join("\n");
    return sendMessage(channelId, threadId, fallbackText, true);
  }
}

async function updateMessage(
  channelId: string,
  messageId: string,
  text: string,
  _asMarkdown = true
): Promise<void> {
  const creds = getLarkCredentialsForChannel(channelId);
  if (!creds) return;
  const token = await getLarkTenantAccessToken(creds);
  try {
    await larkApi<Record<string, unknown>>(
      token,
      "PATCH",
      `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
      {
        msg_type: "text",
        content: JSON.stringify({ text }),
      }
    );
  } catch (error) {
    log.warn("Failed to update Lark message", {
      channelId,
      messageId,
      error: String(error),
    });
    const mapped = sentMessageThreadMap.get(messageId);
    if (mapped) {
      await sendMessage(mapped.channelId, mapped.threadId, text, true);
    }
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
  sendMessage,
  updateMessage,
  deleteMessage,
  fetchThreadHistory,
  buildAgentContext: async ({ channelId, threadId, userId, threadHistory }) =>
    buildLarkContext(channelId, threadId, userId, threadHistory),
};

const coreRuntime = createCoreRuntime({
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
    const idRecord = record.id;
    if (!idRecord || typeof idRecord !== "object") continue;
    const openId = (idRecord as Record<string, unknown>).open_id;
    if (typeof openId === "string" && openId.trim().length > 0) {
      ids.push(openId.trim());
    }
  }
  return ids;
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

type LarkIncomingEvent = NonNullable<LarkIncomingEnvelope["event"]>;

function isLarkLongConnectionEnabled(): boolean {
  const raw = process.env.LARK_LONG_CONNECTION?.trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "off", "no"].includes(raw);
}

async function processLarkIncomingEvent(event: LarkIncomingEvent): Promise<void> {
  const message = event.message;
  const senderOpenId = event.sender?.sender_id?.open_id?.trim() || "";
  const channelId = message?.chat_id?.trim() || "";
  const messageId = message?.message_id?.trim() || "";
  const threadId = message?.root_id?.trim() || message?.parent_id?.trim() || messageId;
  const isThreadReply = Boolean(message?.root_id || message?.parent_id);

  logLarkEvent("Lark inbound event received", {
    channelId,
    messageId,
    threadId,
    senderOpenId,
    messageType: message?.message_type ?? "",
    isThreadReply,
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
  if (botOpenId && senderOpenId === botOpenId) {
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

  const mentions = parseMentionedOpenIds(message?.mentions);
  const isMentioned = botOpenId ? mentions.includes(botOpenId) : false;
  const active = isThreadActive(channelId, threadId);
  const rawText = parseLarkText(message?.content);
  const text = stripLarkMentionMarkup(rawText);

  logLarkEvent("Lark inbound parsed", {
    channelId,
    messageId,
    botOpenId: botOpenId ?? "",
    mentionCount: mentions.length,
    isMentioned,
    activeThread: active,
    textLength: text.length,
  });

  if (isSettingsCommand(text)) {
    logLarkEvent("Lark inbound matched /setting", {
      channelId,
      threadId,
      messageId,
    });
    await sendSettingsCard(channelId, threadId);
    return;
  }

  if (isThreadReply) {
    if (!isMentioned && !active) {
      logLarkEvent("Lark inbound ignored: thread reply without mention and inactive thread", {
        channelId,
        threadId,
        messageId,
      });
      return;
    }
  } else if (!isMentioned) {
    logLarkEvent("Lark inbound ignored: top-level message without mention", {
      channelId,
      threadId,
      messageId,
    });
    return;
  }

  if (!text) {
    logLarkEvent("Lark inbound ignored: empty text after mention stripping", {
      channelId,
      messageId,
    });
    return;
  }

  if (isStopCommand(text)) {
    logLarkEvent("Lark inbound matched stop command", {
      channelId,
      threadId,
      messageId,
    });
    const stopped = await coreRuntime.handleStopCommand(channelId, threadId);
    if (stopped) {
      await sendMessage(channelId, threadId, "Request stopped.", true);
    }
    return;
  }

  markThreadActive(channelId, threadId);
  logLarkEvent("Lark inbound accepted: forwarding to core runtime", {
    channelId,
    threadId,
    messageId,
    userId: senderOpenId,
  });
  await coreRuntime.handleIncomingMessage(
    {
      channelId,
      replyThreadId: threadId,
      threadId,
      userId: senderOpenId,
      messageId,
    },
    text
  );
  logLarkEvent("Lark inbound handled by core runtime", {
    channelId,
    threadId,
    messageId,
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
    });

    const wsClient = new Lark.WSClient({
      appId: creds.appId,
      appSecret: creds.appSecret,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.warn,
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

  if (envelope.header?.event_type !== "im.message.receive_v1") {
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
  if (larkRuntimeStarted) return true;
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
}

export async function stopLarkRuntime(reason: string): Promise<void> {
  if (!larkRuntimeStarted) return;
  larkRuntimeStarted = false;
  await stopLarkLongConnections(reason);
  tenantTokenCache.clear();
  botOpenIdCache.clear();
  sentMessageThreadMap.clear();
  log.debug("Lark runtime stopped", { reason });
}
