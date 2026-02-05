import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { existsSync } from "fs";
import { join } from "path";
import {
  getSlackTargetChannels,
  getSlackAppToken,
  getSlackBotTokens,
  getChannelDevServerId,
  getChannelModel,
  getChannelOpenCodeServerUrl,
  getDevServers,
  getGitHubInfoForUser,
  isLocalMode,
  resolveChannelCwd,
} from "@ode/config";
import { markdownToSlack, splitForSlack, truncateForSlack } from "./formatter";
import {
  markThreadActive,
  isThreadActive,
  getPendingRestartMessages,
  clearPendingRestartMessages,
} from "@ode/config/local/settings";
import { createCoreRuntime } from "@ode/core/runtime";
import type { IMAdapter } from "@ode/core/types";
import { createAgentAdapter } from "@ode/agents/adapter";
import type { OpenCodeMessageContext } from "@ode/agents";
import { log } from "@ode/utils";
import { getSlackActionApiUrl } from "./config";
import { getAllBotTokens, getProfileBySlackUserId, getSlackAppTokenFromServer } from "@ode/config/db";

export interface MessageContext {
  channelId: string;
  threadId: string;
  userId: string;
  messageId: string;
  opencodeServerUrl?: string;
  workspaceName?: string;
}


let app: App | null = null;


type WorkspaceAuth = {
  botToken: string;
  workspaceName: string;
  teamId: string | null;
  enterpriseId: string | null;
  botUserId: string | null;
  botId: string | null;
  userId: string | null;
};

const teamAuthMap = new Map<string, WorkspaceAuth>();
const enterpriseAuthMap = new Map<string, WorkspaceAuth>();
const channelWorkspaceMap = new Map<string, string>();
const channelBotTokenMap = new Map<string, string>();

export function clearSlackAuthState(): void {
  teamAuthMap.clear();
  enterpriseAuthMap.clear();
  channelWorkspaceMap.clear();
  channelBotTokenMap.clear();
}

export function resetSlackState(): void {
  clearSlackAuthState();
  app = null;
}

type SlackThreadMessage = {
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  subtype?: string;
};

// Global rate limiter for chat.update calls across all messages
// Slack's rate limit is roughly 1 request per second for chat.update
let globalLastUpdate = 0;
const GLOBAL_UPDATE_INTERVAL_MS = 1000;
let globalUpdateQueue: Array<{ channelId: string; messageTs: string; text: string; asMarkdown: boolean; resolve: () => void }> = [];
let globalQueueProcessing = false;

function getOdeSlackApiUrl(): string | undefined {
  return getSlackActionApiUrl();
}

async function buildSlackContext(
  cwd: string,
  channelId: string,
  threadId: string,
  userId: string,
  threadHistory?: string | null
): Promise<OpenCodeMessageContext> {
  return {
    threadHistory: threadHistory || undefined,
    slack: {
      channelId,
      threadId,
      userId,
      threadHistory: threadHistory || undefined,
      hasCustomSlackTool: await hasOdeSlackTool(cwd),
      odeSlackApiUrl: getOdeSlackApiUrl(),
      hasGitHubToken: Boolean(getGitHubInfoForUser(userId)?.token),
    },
  };
}

async function processGlobalUpdateQueue(): Promise<void> {
  if (globalQueueProcessing || globalUpdateQueue.length === 0) return;
  globalQueueProcessing = true;

  while (globalUpdateQueue.length > 0) {
    const now = Date.now();
    const timeSinceLastUpdate = now - globalLastUpdate;

    if (timeSinceLastUpdate < GLOBAL_UPDATE_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, GLOBAL_UPDATE_INTERVAL_MS - timeSinceLastUpdate));
    }

    const item = globalUpdateQueue.shift();
    if (!item) break;

    globalLastUpdate = Date.now();

    try {
      const slackApp = getApp();
      const formattedText = item.asMarkdown ? markdownToSlack(item.text) : item.text;
      const truncatedText = truncateForSlack(formattedText);

      const botToken = getChannelBotToken(item.channelId);
      if (!botToken) {
        log.warn("No Slack bot token available for message update", { channelId: item.channelId });
      }
      await slackApp.client.chat.update({
        channel: item.channelId,

        ts: item.messageTs,
        text: truncatedText,
        token: botToken,
      });
    } catch (err) {
      log.debug("Failed to update message", { error: String(err) });
    }

    item.resolve();
  }

  globalQueueProcessing = false;
}

export async function createSlackApp(): Promise<App> {
  const appToken = isLocalMode()
    ? getSlackAppToken().trim()
    : (await getSlackAppTokenFromServer()).trim();

  if (!appToken) {
    throw new Error("Slack app token missing");
  }

  app = new App({
    socketMode: true,
    appToken,
    authorize: async ({ teamId, enterpriseId }) => {
      const auth = resolveWorkspaceAuth(teamId, enterpriseId);
      if (!auth) {
        log.warn("No Slack auth for workspace", { teamId, enterpriseId });
        throw new Error("Missing Slack auth for workspace");
      }

      return {
        botToken: auth.botToken,
        botId: auth.botId ?? undefined,
        botUserId: auth.botUserId ?? undefined,
      };
    },
  });

  return app;
}

export function getApp(): App {
  if (!app) throw new Error("Slack app not initialized");
  return app;
}

function isAuthorizedChannel(channelId: string): boolean {
  if (!isLocalMode()) return true;
  const targetChannels = getSlackTargetChannels();
  if (!targetChannels) return true;
  return targetChannels.includes(channelId);
}

function resolveWorkspaceAuth(
  teamId?: string,
  enterpriseId?: string
): WorkspaceAuth | undefined {
  if (teamId && teamAuthMap.has(teamId)) {
    return teamAuthMap.get(teamId);
  }

  if (enterpriseId && enterpriseAuthMap.has(enterpriseId)) {
    return enterpriseAuthMap.get(enterpriseId);
  }

  return undefined;
}

export function getChannelBotToken(channelId: string): string | undefined {
  const mapped = channelBotTokenMap.get(channelId);
  if (!isLocalMode()) return mapped;
  if (mapped) return mapped;
  const tokens = getSlackBotTokens()
    .map((entry) => entry.token)
    .filter((token) => token && token.trim().length > 0);
  return tokens[0];
}

function registerChannelBotToken(channelId: string, botToken: string | undefined): void {
  if (!botToken) return;
  if (channelBotTokenMap.has(channelId)) return;
  channelBotTokenMap.set(channelId, botToken);
}

async function hasOdeSlackTool(workingPath: string): Promise<boolean> {
  const basePath = join(workingPath, ".opencode", "tools");
  const candidates = [
    "ode_action.ts",
    "ode_action.js",
    "ode_action.mjs",
    "ode_action.cjs",
  ];

  for (const candidate of candidates) {
    const file = Bun.file(join(basePath, candidate));
    if (await file.exists()) return true;
  }

  return false;
}

function truncateToken(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function describeSettingsIssues(channelId: string): string[] {
  const issues: string[] = [];
  const devServers = getDevServers();
  const devServerId = getChannelDevServerId(channelId);
  const model = getChannelModel(channelId);
  const { workingDirectory } = resolveChannelCwd(channelId);

  if (!devServerId) {
    issues.push("Dev server not configured.");
  }

  const server = devServerId
    ? devServers.find((entry) => entry.id === devServerId)
    : undefined;

  if (devServerId && !server) {
    issues.push("Dev server not found in config.");
  }

  if (!model) {
    issues.push("Model not configured.");
  } else if (server && !server.models.includes(model)) {
    issues.push("Model not available on the selected dev server.");
  }

  if (!workingDirectory) {
    issues.push("Working directory not configured.");
  } else if (!existsSync(workingDirectory)) {
    issues.push(`Working directory not found: ${workingDirectory}`);
  }

  return issues;
}

function isSettingsCommand(text: string): boolean {
  return /^\/setting\b/i.test(text.trim());
}

function isGitHubCommand(text: string): boolean {
  return /^\/gh\b/i.test(text.trim());
}

async function postSettingsLauncher(
  channelId: string,
  userId: string,
  client: WebClient
): Promise<void> {
  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: "Open channel settings",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Open channel settings for dev server, model, and working directory." },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "open_settings_modal",
            text: { type: "plain_text", text: "Open settings" },
            value: channelId,
          },
        ],
      },
    ],
  });
}

async function postGitHubLauncher(
  channelId: string,
  userId: string,
  client: WebClient
): Promise<void> {
  const hasToken = Boolean(getGitHubInfoForUser(userId)?.token);
  const statusText = hasToken
    ? "GitHub token is set for your account."
    : "No GitHub token set yet.";

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text: "Open GitHub info settings",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${statusText} Add or update your info to enable GitHub CLI actions.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: "open_github_token_modal",
            text: { type: "plain_text", text: "Set GitHub info" },
            value: channelId,
          },
        ],
      },
    ],
  });
}

async function fetchWorkspaceAuth(botToken: string, workspaceName: string): Promise<WorkspaceAuth | null> {
  try {
    const client = new WebClient(botToken);
    const auth = await client.auth.test();
    return {
      botToken,
      workspaceName,
      teamId: (auth as any).team_id ?? null,
      enterpriseId: (auth as any).enterprise_id ?? null,
      botUserId: (auth as any).bot_user_id ?? (auth as any).user_id ?? null,
      botId: (auth as any).bot_id ?? null,
      userId: (auth as any).user_id ?? null,
    };
  } catch (err) {
    log.error("Slack auth.test failed", {
      botToken: truncateToken(botToken),
      workspaceName,
      error: String(err),
    });
    return null;
  }
}

function registerWorkspaceAuth(auth: WorkspaceAuth): void {
  if (auth.teamId) {
    teamAuthMap.set(auth.teamId, auth);
  }
  if (auth.enterpriseId) {
    enterpriseAuthMap.set(auth.enterpriseId, auth);
  }
}

export async function initializeWorkspaceAuth(): Promise<void> {
  const localMode = isLocalMode();

  const combined = new Map<string, string | null>();

  if (localMode) {
    for (const record of getSlackBotTokens()) {
      combined.set(record.token, record.workspaceName ?? "config");
    }
  } else {
    const tokens = await getAllBotTokens();
    for (const record of tokens) {
      if (record.botToken) {
        combined.set(record.botToken, record.workspaceName ?? "db");
      }
    }
  }

  if (combined.size === 0) {
    log.warn("No Slack bot tokens configured", { mode: localMode ? "local" : "cloud" });
  }

  for (const [botToken, workspaceName] of combined.entries()) {
    if (!botToken) continue;
    const name = workspaceName ?? "unknown";
    const auth = await fetchWorkspaceAuth(botToken, name);
    if (!auth) continue;
    registerWorkspaceAuth(auth);
    log.info("Registered Slack workspace auth", {
      workspace: name,
      teamId: auth.teamId,
      enterpriseId: auth.enterpriseId,
      botUserId: auth.botUserId,
      botToken: truncateToken(botToken),
    });
  }
}

export async function sendMessage(
  channelId: string,
  threadId: string,
  text: string,
  asMarkdown = true
): Promise<string | undefined> {
  const slackApp = getApp();
  const formattedText = asMarkdown ? markdownToSlack(text) : text;
  const chunks = splitForSlack(formattedText);
  const workspace = channelWorkspaceMap.get(channelId) || "unknown";
  const botToken = getChannelBotToken(channelId);

  if (!botToken) {
    log.warn("No Slack bot token available for channel", { channelId });
  }

  log.info("[SLACK] Outgoing message", {
    workspace,
    channel: channelId,
    thread: threadId,
    text,
    chunks: chunks.length,
  });

  let lastTs: string | undefined;
  for (const chunk of chunks) {
    const result = await slackApp.client.chat.postMessage({
      channel: channelId,
      thread_ts: threadId,
      text: chunk,
      token: botToken,
    });
    lastTs = result.ts;
  }
  return lastTs;
}

export async function deleteMessage(
  channelId: string,
  messageTs: string
): Promise<void> {
  try {
    const slackApp = getApp();
    const botToken = getChannelBotToken(channelId);
    if (!botToken) {
      log.warn("No Slack bot token available for message delete", { channelId });
    }
    await slackApp.client.chat.delete({
      channel: channelId,
      ts: messageTs,
      token: botToken,
    });
  } catch {
    // Ignore delete failures
  }
}

async function updateMessageThrottled(
  channelId: string,
  messageTs: string,
  text: string,
  asMarkdown = true
): Promise<void> {
  // Remove any existing queued updates for this message (only keep latest)
  // Use in-place splice instead of filter to avoid reassigning the array,
  // which would break the while loop in processGlobalUpdateQueue
  // Also resolve removed items' promises so callers don't hang forever
  for (let i = globalUpdateQueue.length - 1; i >= 0; i--) {
    const item = globalUpdateQueue[i];
    if (item && item.channelId === channelId && item.messageTs === messageTs) {
      globalUpdateQueue.splice(i, 1);
      item.resolve(); // Resolve so the awaiting code can continue
    }
  }

  // Queue the update
  return new Promise<void>((resolve) => {
    globalUpdateQueue.push({ channelId, messageTs, text, asMarkdown, resolve });
    void processGlobalUpdateQueue();
  });
}

function formatThreadAuthor(message: SlackThreadMessage): string {
  if (message.user) return `<@${message.user}>`;
  if (message.bot_id) return `bot:${message.bot_id}`;
  if (message.username) return message.username;
  return "unknown";
}

async function fetchThreadHistory(
  channelId: string,
  threadId: string,
  messageId: string
): Promise<string | null> {
  try {
    const messages: SlackThreadMessage[] = [];
    let cursor: string | undefined;
    const client = getApp().client;
    const token = getChannelBotToken(channelId);

    do {
      const response = await client.conversations.replies({
        channel: channelId,
        ts: threadId,
        limit: 200,
        cursor,
        token,
      });

      const batch = response.messages as SlackThreadMessage[] | undefined;
      if (batch?.length) {
        messages.push(...batch);
      }

      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);

    const history = messages
      .filter((message) => message.ts && message.ts !== messageId)
      .filter((message) => typeof message.text === "string" && message.text.trim().length > 0)
      .map((message) => `${formatThreadAuthor(message)}: ${message.text}`);

    if (history.length === 0) {
      return null;
    }

    return history.join("\n");
  } catch {
    return null;
  }
}

const slackAdapter: IMAdapter = {
  sendMessage,
  updateMessage: updateMessageThrottled,
  deleteMessage,
  fetchThreadHistory,
  buildAgentContext: async ({ cwd, channelId, threadId, userId, threadHistory }) =>
    buildSlackContext(cwd, channelId, threadId, userId, threadHistory),
};

const coreRuntime = createCoreRuntime({
  im: slackAdapter,
  agent: createAgentAdapter(),
});

export async function recoverPendingRequests(): Promise<void> {
  await coreRuntime.recoverPendingRequests();

  const pendingRestartMessages = getPendingRestartMessages();
  if (pendingRestartMessages.length === 0) {
    return;
  }

  log.info("Updating pending restart messages", { count: pendingRestartMessages.length });

  for (const pendingRestart of pendingRestartMessages) {
    await updateMessageThrottled(
      pendingRestart.channelId,
      pendingRestart.messageTs,
      "Restarting Ode complete.",
      false
    );
  }

  clearPendingRestartMessages();
}

export async function handleButtonSelection(
  channelId: string,
  threadId: string,
  userId: string,
  selection: string,
  messageTs: string
): Promise<void> {
  await coreRuntime.handleButtonSelection({
    channelId,
    threadId,
    userId,
    selection,
    messageTs,
  });
}

export function setupMessageHandlers(): void {
  const slackApp = getApp();

  // Handle messages
  slackApp.message(async ({ message, say, client }) => {
    // Ignore all message subtypes (edits, deletes, etc) - only process new messages
    if (message.subtype !== undefined) return;
    if (!("text" in message) || !message.text) return;
    if (!("user" in message)) return;

    const channelId = message.channel;
    const userId = message.user;
    const text = message.text;
    const threadId = message.thread_ts || message.ts;

    if (!isAuthorizedChannel(channelId)) {
      log.info("[DROP] Unauthorized channel", { channelId });
      return;
    }
    registerChannelBotToken(channelId, client.token);

    // Get bot user ID for this workspace
    const authResult = await client.auth.test();
    const currentBotUserId = authResult.user_id as string;
    if (authResult.team_id) {
      const auth = resolveWorkspaceAuth(authResult.team_id, authResult.enterprise_id ?? undefined);
      if (auth?.workspaceName && !channelWorkspaceMap.has(channelId)) {
        channelWorkspaceMap.set(channelId, auth.workspaceName);
      }
      registerChannelBotToken(channelId, auth?.botToken);
    }

    if (userId === currentBotUserId) {
      log.debug("[DROP] Message from bot user", { channelId, userId });
      return;
    }

    // Check for stop command
    if (/\bstop\b/i.test(text)) {
      const stopped = await coreRuntime.handleStopCommand(channelId, threadId);
      if (stopped) {
        await say({
          text: "Request stopped.",
          thread_ts: threadId,
        });
        return;
      }
    }

    // Check if bot is mentioned or thread is active
    const isMention = currentBotUserId ? text.includes(`<@${currentBotUserId}>`) : false;
    const threadActive = isThreadActive(channelId, threadId);

    if (!isMention && !threadActive) {
      log.info("[DROP] Not mentioned and thread inactive", { channelId, threadId });
      return;
    }

    // If message mentions someone else (but not us), ignore it - it's not for us
    const mentionsOthers = /<@U[A-Z0-9]+>/g.test(text) && !isMention;
    if (mentionsOthers) {
      log.info("[DROP] Mentions other user", { channelId, threadId });
      return;
    }

    markThreadActive(channelId, threadId);

    const cleanText = currentBotUserId
      ? text.replace(new RegExp(`<@${currentBotUserId}>`, "g"), "").trim()
      : text.trim();

    if (isGitHubCommand(cleanText)) {
      if (isMention) {
        await postGitHubLauncher(channelId, userId, client);
      }
      return;
    }

    if (isSettingsCommand(cleanText)) {
      if (isMention) {
        await postSettingsLauncher(channelId, userId, client);
      }
      return;
    }

    const settingsIssues = describeSettingsIssues(channelId);
    if (settingsIssues.length > 0) {
      await say({
        text: `Channel settings need attention:\n- ${settingsIssues.join("\n- ")}`,
        thread_ts: threadId,
      });
      await postSettingsLauncher(channelId, userId, client);
      return;
    }

    const workspaceName = channelWorkspaceMap.get(channelId) || "unknown";

    const localMode = isLocalMode();
    const channelServerUrl = getChannelOpenCodeServerUrl(channelId);
    let profile = null;
    if (!localMode) {
      try {
        profile = await getProfileBySlackUserId(userId);
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

    const context: MessageContext = {
      channelId,
      threadId,
      userId,
      messageId: message.ts,
      opencodeServerUrl: localMode ? channelServerUrl : profile?.opencode_server_url || undefined,
      workspaceName,
    };

    await coreRuntime.handleIncomingMessage(context, cleanText);
  });

}
