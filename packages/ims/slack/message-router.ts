import { log } from "@/utils";
import {
  formatIncomingDropMessage,
  parseIncomingCommand,
  type IncomingFlowResult,
} from "@/ims/shared/incoming-message-processor";
import type { InboundDecision } from "@/core/model/inbound-decision";
import type { RawInboundEvent } from "@/core/model/raw-inbound-event";
import { createProcessorId, scopeChannelId } from "@/ims/shared/processor-scope";
import { RuntimeCache } from "@/shared/cache/runtime-cache";
import { SlackInboundAdapter } from "@/ims/slack/slack-inbound-adapter";

type RouterDeps = {
  app: any;
  isAuthorizedChannel: (channelId: string) => boolean;
  resolveWorkspaceAuth: (
    credentialKey?: string
  ) => { workspaceId?: string; workspaceName?: string; botToken?: string; [key: string]: unknown } | undefined;
  syncWorkspaceForChannel: (
    channelId: string,
    workspaceAuth: { workspaceId?: string; workspaceName?: string; botToken?: string; [key: string]: unknown } | undefined
  ) => Promise<boolean>;
  getChannelWorkspaceName: (channelId: string) => string | undefined;
  setChannelWorkspaceName: (channelId: string, workspaceName: string) => void;
  setChannelWorkspaceAuth: (
    channelId: string,
    auth: { workspaceId?: string; workspaceName?: string; botToken?: string; [key: string]: unknown } | undefined
  ) => void;
  isThreadActive: (channelId: string, threadId: string) => boolean;
  postGeneralSettingsLauncher: (channelId: string, userId: string, client: any) => Promise<void>;
  describeSettingsIssues: (channelId: string) => string[];
  handleInboundEvent: (event: RawInboundEvent) => Promise<void>;
};

type WorkspaceAuth = ReturnType<RouterDeps["resolveWorkspaceAuth"]>;

const slackInboundAdapter = new SlackInboundAdapter();

function toIncomingFlowResult(decision: InboundDecision): IncomingFlowResult {
  switch (decision.kind) {
    case "ignore":
      return { type: "ignore", reason: decision.reason };
    case "stop":
      return { type: "stop", text: "stop" };
    case "command":
      return { type: "forward", text: decision.args.join(" ").trim() };
    case "message":
      return { type: "forward", text: decision.text };
  }
}

type BotIdentity = {
  botUserId: string;
  teamId?: string;
  enterpriseId?: string;
};

type IncomingMessageData = {
  channelId: string;
  userId: string;
  text: string;
  threadId: string;
  messageId: string;
};

function syncWorkspaceAuth(
  deps: RouterDeps,
  channelId: string,
  credentialKey?: string
): WorkspaceAuth {
  const auth = deps.resolveWorkspaceAuth(credentialKey);
  if (auth?.workspaceName && !deps.getChannelWorkspaceName(channelId)) {
    deps.setChannelWorkspaceName(channelId, auth.workspaceName);
  }
  deps.setChannelWorkspaceAuth(channelId, auth);
  return auth;
}

function stripBotMention(text: string, botUserId: string): string {
  if (!botUserId) return text.trim();
  return text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim();
}

function extractIncomingMessageData(message: any): IncomingMessageData | null {
  if (message.subtype !== undefined) return null;
  if (!("text" in message) || !message.text) return null;
  if (!("user" in message) || !message.user) return null;

  return {
    channelId: message.channel,
    userId: message.user,
    text: message.text,
    threadId: message.thread_ts || message.ts,
    messageId: message.ts,
  };
}

function shouldDropForOtherMentions(text: string, isMention: boolean): boolean {
  return /<@U[A-Z0-9]+>/g.test(text) && !isMention;
}

function tokenLast6(token?: string): string | undefined {
  if (!token) return undefined;
  return token.slice(-6);
}

async function maybeRefreshWorkspaceForMention(params: {
  deps: RouterDeps;
  channelId: string;
  isMention: boolean;
  workspaceAuth: WorkspaceAuth;
}): Promise<void> {
  const { deps, channelId, isMention, workspaceAuth } = params;
  if (!isMention) return;
  if (deps.isAuthorizedChannel(channelId)) return;
  await deps.syncWorkspaceForChannel(channelId, workspaceAuth);
}

async function maybeNotifySettingsIssues(
  deps: RouterDeps,
  channelId: string,
  threadId: string,
  userId: string,
  client: any,
  say: any,
  flowResult: IncomingFlowResult,
): Promise<boolean> {
  if (flowResult.type === "ignore") return false;

  const settingsIssues = deps.describeSettingsIssues(channelId);
  if (settingsIssues.length === 0) return false;

  await say({
    text: `Channel settings need attention:\n- ${settingsIssues.join("\n- ")}`,
    thread_ts: threadId,
  });
  log.info("Slack settings launcher triggered by configuration issues", {
    channelId,
    threadId,
    userId,
    issuesCount: settingsIssues.length,
    issues: settingsIssues,
  });
  await deps.postGeneralSettingsLauncher(channelId, userId, client);
  return true;
}

async function maybeHandleLauncherCommand(params: {
  deps: RouterDeps;
  cleanText: string;
  isMention: boolean;
  channelId: string;
  userId: string;
  client: any;
}): Promise<boolean> {
  const { deps, cleanText, isMention, channelId, userId, client } = params;
  const command = parseIncomingCommand(cleanText);
  if (command !== "setting") return false;
  if (isMention) {
    log.info("Slack settings launcher command matched", {
      channelId,
      userId,
      cleanText,
    });
    await deps.postGeneralSettingsLauncher(channelId, userId, client);
  } else {
    log.debug("Slack settings command ignored because bot was not mentioned", {
      channelId,
      userId,
      cleanText,
    });
  }
  return true;
}

function getCacheKey(credentialKey?: string): string | undefined {
  if (!credentialKey) return undefined;
  return `credential:${credentialKey}`;
}

async function getBotIdentity(params: {
  client: any;
  cache: RuntimeCache<string, BotIdentity>;
  credentialKey?: string;
}): Promise<BotIdentity> {
  const { client, cache, credentialKey } = params;
  const key = getCacheKey(credentialKey);
  if (key) {
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
  }

  const authResult = await client.auth.test();
  const identity: BotIdentity = {
    botUserId: (authResult.user_id as string) || "",
    teamId: authResult.team_id as string | undefined,
    enterpriseId: authResult.enterprise_id as string | undefined,
  };

  if (key) {
    cache.set(key, identity);
  }
  return identity;
}

export function registerSlackMessageRouter(deps: RouterDeps): void {
  const slackApp = deps.app;
  const botIdentityCache = new RuntimeCache<string, BotIdentity>({
    max: 200,
    ttlMs: 24 * 60 * 60 * 1000,
  });

  slackApp.message(async ({ message, say, client, context }: any) => {
    let contextData: IncomingMessageData | null = null;

    try {
      const incoming = extractIncomingMessageData(message);
      if (!incoming) return;
      contextData = incoming;

      const { channelId, userId, text, threadId, messageId } = incoming;
      const contextBotToken = context?.botToken as string | undefined;
      let workspaceAuth = syncWorkspaceAuth(
        deps,
        channelId,
        contextBotToken
      );
      const credentialKey =
        contextBotToken
        ?? workspaceAuth?.botToken
        ?? workspaceAuth?.workspaceId
        ?? undefined;
      const identity = await getBotIdentity({
        client,
        cache: botIdentityCache,
        credentialKey,
      });

      const currentBotUserId = identity.botUserId;
      const processorId = createProcessorId("slack", contextBotToken ?? workspaceAuth?.botToken ?? "");
      const scopedChannelId = scopeChannelId(processorId, channelId);
      if (!workspaceAuth && contextBotToken) {
        workspaceAuth = syncWorkspaceAuth(deps, channelId, contextBotToken);
      }

      if (userId === currentBotUserId) {
        log.debug("[DROP] Message from bot user", { channelId, userId });
        return;
      }

      const isMention = currentBotUserId ? text.includes(`<@${currentBotUserId}>`) : false;
      const cleanText = stripBotMention(text, currentBotUserId);
      await maybeRefreshWorkspaceForMention({
        deps,
        channelId,
        isMention,
        workspaceAuth,
      });

      const threadActive = deps.isThreadActive(scopedChannelId, threadId);
      const inboundEvent: RawInboundEvent = {
        platform: "slack",
        botId: contextBotToken ?? workspaceAuth?.botToken ?? "default",
        channelId: scopedChannelId,
        rawChannelId: channelId,
        threadId,
        replyThreadId: threadId,
        messageId,
        userId,
        isTopLevel: threadId === messageId,
        mentionedBot: isMention,
        activeThread: threadActive,
        rawText: text,
        normalizedText: cleanText,
        receivedAtMs: Date.now(),
      };
      const flowResult = toIncomingFlowResult(slackInboundAdapter.evaluate(inboundEvent));

      if (shouldDropForOtherMentions(text, isMention)) {
        log.info("[DROP] Mentions other user", {
          channelId,
          threadId,
          imName: workspaceAuth?.workspaceName ?? deps.getChannelWorkspaceName(channelId) ?? "unknown",
          botTokenLast6: tokenLast6(workspaceAuth?.botToken),
          botUserId: currentBotUserId || "unknown",
        });
        return;
      }

      if (await maybeHandleLauncherCommand({
        deps,
        cleanText,
        isMention,
        channelId,
        userId,
        client,
      })) {
        return;
      }

      if (await maybeNotifySettingsIssues(deps, channelId, threadId, userId, client, say, flowResult)) {
        return;
      }

      if (flowResult.type === "ignore") {
        if (flowResult.reason === "not_mentioned_and_inactive") {
          log.debug(formatIncomingDropMessage(flowResult.reason), { channelId, threadId });
          return;
        }
        await say({
          text: "Hi! How can I help you? Just ask me anything.",
          thread_ts: threadId,
        });
        return;
      }

      await deps.handleInboundEvent(inboundEvent);
    } catch (error) {
      log.error("Slack message router failed", {
        channelId: contextData?.channelId,
        threadId: contextData?.threadId,
        messageId: contextData?.messageId,
        error: String(error),
      });
      if (contextData) {
        await say({
          text: "I hit an internal error while handling that message. Please try again.",
          thread_ts: contextData.threadId,
        });
      }
    }
  });
}
