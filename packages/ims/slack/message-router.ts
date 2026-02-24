import { log } from "@/utils";
import { isStopCommand } from "@/ims/shared/stop-command";
import { evaluateIncomingMessage, formatIncomingDropMessage } from "@/ims/shared/incoming-pipeline";
import { executeIncomingFlow } from "@/ims/shared/incoming-executor";
import { buildIncomingContext } from "@/ims/shared/incoming-normalizer";
import { parseIncomingCommand } from "@/ims/shared/command-router";
import type { AgentProviderId } from "@/shared/agent-provider";
import {
  toCoreMessageContext,
  type UnifiedMessageContext,
} from "@/ims/shared/message-context";

type RouterDeps = {
  app: any;
  isAuthorizedChannel: (channelId: string) => boolean;
  resolveWorkspaceAuth: (
    teamId?: string,
    enterpriseId?: string
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
  markThreadActive: (channelId: string, threadId: string) => void;
  postGeneralSettingsLauncher: (channelId: string, userId: string, client: any) => Promise<void>;
  describeSettingsIssues: (channelId: string) => string[];
  getChannelAgentProvider: (channelId: string) => AgentProviderId;
  handleStopCommand: (channelId: string, threadId: string) => Promise<boolean>;
  handleIncomingMessage: (context: {
    channelId: string;
    replyThreadId: string;
    threadId: string;
    userId: string;
    messageId: string;
    workspaceName?: string;
  }, text: string) => Promise<void>;
};

type WorkspaceAuth = ReturnType<RouterDeps["resolveWorkspaceAuth"]>;

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
  teamId?: string,
  enterpriseId?: string
): WorkspaceAuth {
  if (!teamId) return undefined;
  const auth = deps.resolveWorkspaceAuth(teamId, enterpriseId);
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
  say: any
): Promise<boolean> {
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

function getCacheKey(teamId?: string, enterpriseId?: string): string {
  if (teamId) return `team:${teamId}`;
  if (enterpriseId) return `enterprise:${enterpriseId}`;
  return "default";
}

async function getBotIdentity(params: {
  client: any;
  cache: Map<string, BotIdentity>;
  teamId?: string;
  enterpriseId?: string;
}): Promise<BotIdentity> {
  const { client, cache, teamId, enterpriseId } = params;
  const key = getCacheKey(teamId, enterpriseId);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const authResult = await client.auth.test();
  const identity: BotIdentity = {
    botUserId: (authResult.user_id as string) || "",
    teamId: (authResult.team_id as string | undefined) ?? teamId,
    enterpriseId: (authResult.enterprise_id as string | undefined) ?? enterpriseId,
  };

  cache.set(key, identity);
  return identity;
}

export function registerSlackMessageRouter(deps: RouterDeps): void {
  const slackApp = deps.app;
  const botIdentityCache = new Map<string, BotIdentity>();

  slackApp.message(async ({ message, say, client, context, body }: any) => {
    let contextData: IncomingMessageData | null = null;

    try {
      const incoming = extractIncomingMessageData(message);
      if (!incoming) return;
      contextData = incoming;

      const { channelId, userId, text, threadId, messageId } = incoming;
      const identity = await getBotIdentity({
        client,
        cache: botIdentityCache,
        teamId: (context?.teamId as string | undefined) ?? (body?.team_id as string | undefined),
        enterpriseId: (context?.enterpriseId as string | undefined) ?? (body?.enterprise_id as string | undefined),
      });

      const currentBotUserId = identity.botUserId;
      const workspaceAuth = syncWorkspaceAuth(
        deps,
        channelId,
        identity.teamId,
        identity.enterpriseId
      );

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

      const threadActive = deps.isThreadActive(channelId, threadId);
      const messageContext: UnifiedMessageContext = buildIncomingContext({
        platform: "slack",
        channelId,
        threadId,
        messageId,
        userId,
        isTopLevel: threadId === messageId,
        mentionedBot: isMention,
        activeThread: threadActive,
        rawText: text,
        normalizedText: cleanText,
      });
      const flowResult = evaluateIncomingMessage(messageContext, isStopCommand);

      if (shouldDropForOtherMentions(text, isMention)) {
        log.info("[DROP] Mentions other user", { channelId, threadId });
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

      if (await maybeNotifySettingsIssues(deps, channelId, threadId, userId, client, say)) {
        return;
      }

      const workspaceName = deps.getChannelWorkspaceName(channelId) || "unknown";
      await executeIncomingFlow({
        context: messageContext,
        flowResult,
        markThreadActive: deps.markThreadActive,
        handleStopCommand: deps.handleStopCommand,
        sendStopAck: async () => {
          await say({ text: "Request stopped.", thread_ts: threadId });
        },
        onIgnore: async (reason) => {
          if (reason === "not_mentioned_and_inactive") {
            log.debug(formatIncomingDropMessage(reason), { channelId, threadId });
            return;
          }
          await say({
            text: "Hi! How can I help you? Just ask me anything.",
            thread_ts: threadId,
          });
        },
        forwardToCore: async (forwardText) => {
          await deps.handleIncomingMessage(
            toCoreMessageContext(messageContext, { workspaceName }),
            forwardText
          );
        },
      });
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
