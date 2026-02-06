import { isLocalMode } from "@/config";
import { log } from "@/utils";

type SlackProfile = { opencode_server_url?: string | null } | null;

type RouterDeps = {
  getApp: () => any;
  isAuthorizedChannel: (channelId: string) => boolean;
  registerChannelBotToken: (channelId: string, token?: string) => void;
  resolveWorkspaceAuth: (teamId?: string, enterpriseId?: string) => { workspaceName?: string; botToken?: string } | undefined;
  getChannelWorkspaceName: (channelId: string) => string | undefined;
  setChannelWorkspaceName: (channelId: string, workspaceName: string) => void;
  isThreadActive: (channelId: string, threadId: string) => boolean;
  markThreadActive: (channelId: string, threadId: string) => void;
  isGitHubCommand: (text: string) => boolean;
  isSettingsCommand: (text: string) => boolean;
  postGitHubLauncher: (channelId: string, userId: string, client: any) => Promise<void>;
  postSettingsLauncher: (channelId: string, userId: string, client: any) => Promise<void>;
  describeSettingsIssues: (channelId: string) => string[];
  getChannelServerUrl: (channelId: string) => string | undefined;
  getProfileBySlackUserId: (userId: string) => Promise<SlackProfile>;
  handleStopCommand: (channelId: string, threadId: string) => Promise<boolean>;
  handleIncomingMessage: (context: {
    channelId: string;
    threadId: string;
    userId: string;
    messageId: string;
    opencodeServerUrl?: string;
    workspaceName?: string;
  }, text: string) => Promise<void>;
};

export function registerSlackMessageRouter(deps: RouterDeps): void {
  const slackApp = deps.getApp();

  slackApp.message(async ({ message, say, client }: any) => {
    if (message.subtype !== undefined) return;
    if (!("text" in message) || !message.text) return;
    if (!("user" in message)) return;

    const channelId = message.channel;
    const userId = message.user;
    const text = message.text;
    const threadId = message.thread_ts || message.ts;

    if (!deps.isAuthorizedChannel(channelId)) {
      log.info("[DROP] Unauthorized channel", { channelId });
      return;
    }
    deps.registerChannelBotToken(channelId, client.token);

    const authResult = await client.auth.test();
    const currentBotUserId = authResult.user_id as string;
    if (authResult.team_id) {
      const auth = deps.resolveWorkspaceAuth(authResult.team_id, authResult.enterprise_id ?? undefined);
      if (auth?.workspaceName && !deps.getChannelWorkspaceName(channelId)) {
        deps.setChannelWorkspaceName(channelId, auth.workspaceName);
      }
      deps.registerChannelBotToken(channelId, auth?.botToken);
    }

    if (userId === currentBotUserId) {
      log.debug("[DROP] Message from bot user", { channelId, userId });
      return;
    }

    if (/\bstop\b/i.test(text)) {
      const stopped = await deps.handleStopCommand(channelId, threadId);
      if (stopped) {
        await say({ text: "Request stopped.", thread_ts: threadId });
        return;
      }
    }

    const isMention = currentBotUserId ? text.includes(`<@${currentBotUserId}>`) : false;
    const threadActive = deps.isThreadActive(channelId, threadId);

    if (!isMention && !threadActive) {
      log.info("[DROP] Not mentioned and thread inactive", { channelId, threadId });
      return;
    }

    const mentionsOthers = /<@U[A-Z0-9]+>/g.test(text) && !isMention;
    if (mentionsOthers) {
      log.info("[DROP] Mentions other user", { channelId, threadId });
      return;
    }

    deps.markThreadActive(channelId, threadId);

    const cleanText = currentBotUserId
      ? text.replace(new RegExp(`<@${currentBotUserId}>`, "g"), "").trim()
      : text.trim();

    if (deps.isGitHubCommand(cleanText)) {
      if (isMention) {
        await deps.postGitHubLauncher(channelId, userId, client);
      }
      return;
    }

    if (deps.isSettingsCommand(cleanText)) {
      if (isMention) {
        await deps.postSettingsLauncher(channelId, userId, client);
      }
      return;
    }

    const settingsIssues = deps.describeSettingsIssues(channelId);
    if (settingsIssues.length > 0) {
      await say({
        text: `Channel settings need attention:\n- ${settingsIssues.join("\n- ")}`,
        thread_ts: threadId,
      });
      await deps.postSettingsLauncher(channelId, userId, client);
      return;
    }

    const workspaceName = deps.getChannelWorkspaceName(channelId) || "unknown";
    const localMode = isLocalMode();
    const channelServerUrl = deps.getChannelServerUrl(channelId);
    let profile: SlackProfile = null;
    if (!localMode) {
      try {
        profile = await deps.getProfileBySlackUserId(userId);
      } catch (err) {
        log.error("Supabase profile lookup failed", { error: String(err) });
        await say({
          text: "Failed to load your OpenCode server settings. Please contact your administrator.",
          thread_ts: threadId,
        });
        return;
      }
    }

    if (localMode && !channelServerUrl) {
      await say({
        text: "OpenCode server URL missing for this channel. Set it in ~/.config/ode/ode.json.",
        thread_ts: threadId,
      });
      return;
    }

    if (!localMode && !profile?.opencode_server_url) {
      await say({
        text: "OpenCode server URL missing for your account. Please contact your administrator.",
        thread_ts: threadId,
      });
      return;
    }

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
        threadId,
        userId,
        messageId: message.ts,
        opencodeServerUrl: localMode ? channelServerUrl || undefined : profile?.opencode_server_url || undefined,
        workspaceName,
      },
      cleanText
    );
  });
}
