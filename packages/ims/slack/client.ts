import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import { existsSync } from "fs";
import { join } from "path";
import {
  getSlackTargetChannels,
  getSlackAppToken,
  getSlackBotTokens,
  getChannelAgentProvider,
  getChannelModel,
  getOpenCodeModels,
  isAgentEnabled,
  getGitHubInfoForUser,
  resolveChannelCwd,
} from "@/config";
import { markdownToSlack, splitForSlack } from "./formatter";
import {
  markThreadActive,
  isThreadActive,
  getPendingRestartMessages,
  clearPendingRestartMessages,
} from "@/config/local/settings";
import { createCoreRuntime } from "@/core/runtime";
import type { IMAdapter } from "@/core/types";
import { createAgentAdapter } from "@/agents/adapter";
import type { OpenCodeMessageContext } from "@/agents";
import { log } from "@/utils";
import { getSlackActionApiUrl } from "./config";
import { createThrottledMessageUpdater } from "./message-updates";
import { fetchThreadHistoryByClient } from "./message-history";
import { registerSlackMessageRouter } from "./message-router";

export interface MessageContext {
  channelId: string;
  threadId: string;
  userId: string;
  messageId: string;
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

const updateMessageThrottled = createThrottledMessageUpdater({
  getApp,
  getChannelBotToken,
});

export async function createSlackApp(): Promise<App> {
  const appToken = getSlackAppToken().trim();

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
  const provider = getChannelAgentProvider(channelId);
  const model = getChannelModel(channelId);
  const { workingDirectory } = resolveChannelCwd(channelId);

  if (!isAgentEnabled(provider)) {
    issues.push(`Agent not enabled: ${provider}`);
  }

  if (provider === "opencode" || provider === "codex") {
    const models = getOpenCodeModels();
    if (!model) {
      issues.push("Model not configured.");
    } else if (!models.includes(model)) {
      issues.push("Model not available in configured OpenCode models.");
    }
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
          text: {
            type: "mrkdwn",
            text: "Open channel settings for agent, model (OpenCode), and working directory.",
          },
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
  const combined = new Map<string, string | null>();

  for (const record of getSlackBotTokens()) {
    combined.set(record.token, record.workspaceName ?? "config");
  }

  if (combined.size === 0) {
    log.warn("No Slack bot tokens configured", { mode: "local" });
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

async function fetchThreadHistory(
  channelId: string,
  threadId: string,
  messageId: string
): Promise<string | null> {
  return fetchThreadHistoryByClient({
    client: getApp().client,
    channelId,
    threadId,
    messageId,
    token: getChannelBotToken(channelId),
  });
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
  registerSlackMessageRouter({
    getApp,
    isAuthorizedChannel,
    registerChannelBotToken,
    resolveWorkspaceAuth,
    getChannelWorkspaceName: (channelId) => channelWorkspaceMap.get(channelId),
    setChannelWorkspaceName: (channelId, workspaceName) => {
      channelWorkspaceMap.set(channelId, workspaceName);
    },
    isThreadActive,
    markThreadActive,
    isGitHubCommand,
    isSettingsCommand,
    postGitHubLauncher,
    postSettingsLauncher,
    describeSettingsIssues,
    getChannelAgentProvider,
    handleStopCommand: (channelId, threadId) => coreRuntime.handleStopCommand(channelId, threadId),
    handleIncomingMessage: (context, text) => coreRuntime.handleIncomingMessage(context, text),
  });

}
