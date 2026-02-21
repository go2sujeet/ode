import { log } from "@/utils";

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
  isGeneralSettingsCommand: (text: string) => boolean;
  postGeneralSettingsLauncher: (channelId: string, userId: string, client: any) => Promise<void>;
  describeSettingsIssues: (channelId: string) => string[];
  getChannelAgentProvider: (channelId: string) => "opencode" | "claudecode" | "codex" | "kimi" | "kiro" | "kilo" | "qwen" | "goose" | "gemini";
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

function shouldDropForThreadContext(isMention: boolean, threadActive: boolean): boolean {
  return !isMention && !threadActive;
}

function shouldDropForOtherMentions(text: string, isMention: boolean): boolean {
  return /<@U[A-Z0-9]+>/g.test(text) && !isMention;
}

async function maybeHandleStopCommand(
  deps: RouterDeps,
  text: string,
  channelId: string,
  threadId: string,
  say: any
): Promise<boolean> {
  if (!/\bstop\b/i.test(text)) return false;
  const stopped = await deps.handleStopCommand(channelId, threadId);
  if (!stopped) return false;

  await say({ text: "Request stopped.", thread_ts: threadId });
  return true;
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

  const commandHandlers: Array<{
    matches: (text: string) => boolean;
    launch: (channelId: string, userId: string, client: any) => Promise<void>;
  }> = [
    { matches: deps.isGeneralSettingsCommand, launch: deps.postGeneralSettingsLauncher },
  ];

  const handler = commandHandlers.find((entry) => entry.matches(cleanText));
  if (!handler) return false;
  if (isMention) {
    await handler.launch(channelId, userId, client);
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
      await maybeRefreshWorkspaceForMention({
        deps,
        channelId,
        isMention,
        workspaceAuth,
      });

      if (await maybeHandleStopCommand(deps, text, channelId, threadId, say)) {
        return;
      }
      const threadActive = deps.isThreadActive(channelId, threadId);

      if (shouldDropForThreadContext(isMention, threadActive)) {
        log.debug("[DROP] Not mentioned and thread inactive", { channelId, threadId });
        return;
      }

      if (shouldDropForOtherMentions(text, isMention)) {
        log.info("[DROP] Mentions other user", { channelId, threadId });
        return;
      }

      deps.markThreadActive(channelId, threadId);

      const cleanText = stripBotMention(text, currentBotUserId);

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
      if (!cleanText) {
        await say({
          text: "Hi! How can I help you? Just ask me anything.",
          thread_ts: threadId,
        });
        return;
      }

      await deps.handleIncomingMessage(
        {
          channelId,
          replyThreadId: threadId,
          threadId,
          userId,
          messageId,
          workspaceName,
        },
        cleanText
      );
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
