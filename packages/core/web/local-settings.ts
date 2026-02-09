import { readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import {
  defaultDashboardConfig,
  sanitizeDashboardConfig,
  type DashboardConfig,
} from "@/config";

const configDir = join(homedir(), ".config", "ode");
const configPath = join(configDir, "ode.json");


export const readLocalSettings = async (): Promise<DashboardConfig> => {
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeDashboardConfig(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
      await writeLocalSettings(sanitized);
    }
    return sanitized;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return defaultDashboardConfig;
    }
    await writeLocalSettings(defaultDashboardConfig);
    return defaultDashboardConfig;
  }
};

export const writeLocalSettings = async (config: DashboardConfig): Promise<void> => {
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
};

type SlackChannel = {
  id: string;
  name: string;
  is_member?: boolean;
};

type SlackTeam = {
  id?: string;
  name?: string;
  domain?: string;
};

type ChannelAgentProvider = DashboardConfig["workspaces"][number]["channelDetails"][number]["agentProvider"];

const KNOWN_AGENT_PROVIDERS = new Set<NonNullable<ChannelAgentProvider>>([
  "opencode",
  "claudecode",
  "codex",
  "kimi",
  "kiro",
  "kilo",
  "qwen",
]);

function normalizeChannelAgentProvider(value: unknown): NonNullable<ChannelAgentProvider> {
  if (typeof value !== "string") return "opencode";
  return KNOWN_AGENT_PROVIDERS.has(value as NonNullable<ChannelAgentProvider>)
    ? value as NonNullable<ChannelAgentProvider>
    : "opencode";
}

const slackRequest = async <T>(token: string, path: string, params?: URLSearchParams) => {
  const url = new URL(`https://slack.com/api/${path}`);
  if (params) {
    url.search = params.toString();
  }
  const response = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
    },
  });
  const data = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!data.ok) {
    const message = data.error ?? "Slack API error";
    throw new Error(message);
  }
  return data;
};

const fetchSlackChannels = async (token: string) => {
  const channels: SlackChannel[] = [];
  let cursor = "";
  do {
    const params = new URLSearchParams({
      limit: "200",
      types: "public_channel,private_channel",
      exclude_archived: "true",
    });
    if (cursor) params.set("cursor", cursor);
    const data = await slackRequest<{
      channels: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", params);
    const joinedChannels = (data.channels ?? []).filter((channel) => channel.is_member === true);
    channels.push(...joinedChannels);
    cursor = data.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return channels;
};

const formatSlackDomain = (domain?: string): string => (domain ? `${domain}.slack.com` : "");

const fetchSlackWorkspaceSnapshot = async (botToken: string): Promise<{ team: SlackTeam; channels: SlackChannel[] }> => {
  const teamInfo = await slackRequest<{ team: SlackTeam }>(botToken, "team.info");
  const channels = await fetchSlackChannels(botToken);
  return { team: teamInfo.team ?? {}, channels };
};

const buildDiscoveredChannelDetails = (
  channels: SlackChannel[],
  fallbackModel: string
): DashboardConfig["workspaces"][number]["channelDetails"] =>
  channels.map((channel) => ({
    id: channel.id,
    name: channel.name ? `#${channel.name}` : "",
    agentProvider: "opencode",
    model: fallbackModel,
    workingDirectory: "",
    baseBranch: "main",
    channelSystemMessage: "",
  }));

const buildSyncedChannelDetails = (
  channels: SlackChannel[],
  workspace: DashboardConfig["workspaces"][number],
  fallbackModel: string
): DashboardConfig["workspaces"][number]["channelDetails"] =>
  channels.map((channel) => {
    const existing = workspace.channelDetails.find((item) => item.id === channel.id);
    const agentProvider = normalizeChannelAgentProvider(existing?.agentProvider);

    return {
      id: channel.id,
      name: channel.name ? `#${channel.name}` : "",
      agentProvider,
      model: existing?.model ?? (agentProvider === "opencode" || agentProvider === "codex" ? fallbackModel : ""),
      workingDirectory: existing?.workingDirectory ?? "",
      baseBranch: existing?.baseBranch?.trim() ? existing.baseBranch.trim() : "main",
      channelSystemMessage: existing?.channelSystemMessage ?? "",
    };
  });

export const discoverSlackWorkspace = async (
  slackAppToken: string,
  slackBotToken: string
): Promise<DashboardConfig["workspaces"][number]> => {
  const appToken = slackAppToken.trim();
  const botToken = slackBotToken.trim();
  if (!appToken) {
    throw new Error("Missing Slack app token");
  }
  if (!botToken) {
    throw new Error("Missing Slack bot token");
  }

  const config = await readLocalSettings();
  const snapshot = await fetchSlackWorkspaceSnapshot(botToken);
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const discoveredWorkspaceId = snapshot.team.id?.trim();
  const workspaceId = discoveredWorkspaceId || `workspace-${config.workspaces.length + 1}`;
  const workspaceName = snapshot.team.name?.trim() || `Workspace ${config.workspaces.length + 1}`;
  const channelDetails = buildDiscoveredChannelDetails(snapshot.channels, fallbackModel);

  return {
    id: workspaceId,
    name: workspaceName,
    domain: formatSlackDomain(snapshot.team.domain),
    status: "active",
    channels: channelDetails.length,
    members: 0,
    lastSync: new Date().toISOString(),
    slackAppToken: appToken,
    slackBotToken: botToken,
    channelDetails,
  };
};

export const syncSlackWorkspace = async (workspaceId: string): Promise<DashboardConfig["workspaces"][number]> => {
  const config = await readLocalSettings();
  const workspaceIndex = config.workspaces.findIndex((item) => item.id === workspaceId);
  if (workspaceIndex === -1) {
    throw new Error("Workspace not found");
  }

  const workspace = config.workspaces[workspaceIndex]!;
  const botToken = workspace.slackBotToken?.trim() ?? "";
  if (!botToken) {
    throw new Error("Missing Slack bot token");
  }

  const snapshot = await fetchSlackWorkspaceSnapshot(botToken);
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const channelDetails = buildSyncedChannelDetails(snapshot.channels, workspace, fallbackModel);

  const updatedWorkspace: DashboardConfig["workspaces"][number] = {
    ...workspace,
    name: snapshot.team.name ?? workspace.name,
    domain: formatSlackDomain(snapshot.team.domain) || workspace.domain,
    channels: channelDetails.length,
    lastSync: new Date().toISOString(),
    channelDetails,
  };

  const nextConfig: DashboardConfig = {
    ...config,
    workspaces: config.workspaces.map((item, index) =>
      index === workspaceIndex ? updatedWorkspace : item
    ),
  };

  await writeLocalSettings(nextConfig);
  return updatedWorkspace;
};
