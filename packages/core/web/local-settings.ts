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

type DiscordGuild = {
  id: string;
  name: string;
};

type DiscordChannel = {
  id: string;
  type: number;
  name?: string;
};

type LarkTenantAccessTokenResponse = {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
};

type LarkBotInfoResponse = {
  code?: number;
  msg?: string;
  bot?: {
    app_name?: string;
    open_id?: string;
  };
};

type LarkTenantInfoResponse = {
  code?: number;
  msg?: string;
  tenant?: {
    name?: string;
  };
};

type LarkChatListResponse = {
  code?: number;
  msg?: string;
  data?: {
    items?: Array<{
      chat_id?: string;
      name?: string;
    }>;
  };
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

const discordRequest = async <T>(token: string, path: string) => {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok) {
    let detail = "Discord API error";
    try {
      const errorPayload = await response.json() as { message?: string };
      if (errorPayload.message) detail = errorPayload.message;
    } catch {
      // noop
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
};

const larkJsonRequest = async <T>(
  path: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(`https://open.feishu.cn${path}`, {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Lark API ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
};

const getLarkTenantAccessToken = async (appId: string, appSecret: string): Promise<string> => {
  const result = await larkJsonRequest<LarkTenantAccessTokenResponse>(
    "/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );

  if ((result.code ?? -1) !== 0 || !result.tenant_access_token) {
    throw new Error(result.msg || "Failed to get Lark tenant access token");
  }

  return result.tenant_access_token;
};

const larkAuthedRequest = async <T>(token: string, path: string): Promise<T> => {
  const result = await larkJsonRequest<T & { code?: number; msg?: string }>(path, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const record = result as { code?: number; msg?: string };
  if ((record.code ?? -1) !== 0) {
    throw new Error(record.msg || "Lark API error");
  }
  return result;
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
    type: "slack",
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

const DISCORD_TEXT_CHANNEL_TYPES = new Set([0, 5, 15]);

async function fetchDiscordWorkspaceSnapshot(botToken: string): Promise<{
  guild: DiscordGuild;
  channels: DiscordChannel[];
}> {
  const guilds = await discordRequest<Array<DiscordGuild>>(botToken, "/users/@me/guilds");
  const guild = guilds[0];
  if (!guild) {
    throw new Error("Discord bot is not a member of any guild");
  }
  const channels = await discordRequest<Array<DiscordChannel>>(botToken, `/guilds/${guild.id}/channels`);
  return {
    guild,
    channels: channels.filter((channel) => DISCORD_TEXT_CHANNEL_TYPES.has(channel.type)),
  };
}

function buildDiscordChannelDetails(
  channels: DiscordChannel[],
  workspace: DashboardConfig["workspaces"][number] | null,
  fallbackModel: string
): DashboardConfig["workspaces"][number]["channelDetails"] {
  return channels.map((channel) => {
    const existing = workspace?.channelDetails.find((item) => item.id === channel.id);
    const agentProvider = normalizeChannelAgentProvider(existing?.agentProvider);
    return {
      id: channel.id,
      name: channel.name || channel.id,
      agentProvider,
      model: existing?.model ?? (agentProvider === "opencode" || agentProvider === "codex" ? fallbackModel : ""),
      workingDirectory: existing?.workingDirectory ?? "",
      baseBranch: existing?.baseBranch?.trim() ? existing.baseBranch.trim() : "main",
      channelSystemMessage: existing?.channelSystemMessage ?? "",
    };
  });
}

export const discoverDiscordWorkspace = async (
  discordBotToken: string
): Promise<DashboardConfig["workspaces"][number]> => {
  const botToken = discordBotToken.trim();
  if (!botToken) {
    throw new Error("Missing Discord bot token");
  }

  const config = await readLocalSettings();
  const snapshot = await fetchDiscordWorkspaceSnapshot(botToken);
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const channelDetails = buildDiscordChannelDetails(snapshot.channels, null, fallbackModel);

  return {
    id: snapshot.guild.id,
    type: "discord",
    name: snapshot.guild.name,
    domain: "discord.com",
    status: "active",
    channels: channelDetails.length,
    members: 0,
    lastSync: new Date().toISOString(),
    discordBotToken: botToken,
    channelDetails,
  };
};

function buildLarkChannelDetails(
  chats: Array<{ chat_id?: string; name?: string }>,
  workspace: DashboardConfig["workspaces"][number] | null,
  fallbackModel: string
): DashboardConfig["workspaces"][number]["channelDetails"] {
  return chats
    .filter((chat) => typeof chat.chat_id === "string" && chat.chat_id.trim().length > 0)
    .map((chat) => {
      const chatId = chat.chat_id!.trim();
      const existing = workspace?.channelDetails.find((item) => item.id === chatId);
      const agentProvider = normalizeChannelAgentProvider(existing?.agentProvider);
      return {
        id: chatId,
        name: chat.name?.trim() || chatId,
        agentProvider,
        model: existing?.model ?? (agentProvider === "opencode" || agentProvider === "codex" ? fallbackModel : ""),
        workingDirectory: existing?.workingDirectory ?? "",
        baseBranch: existing?.baseBranch?.trim() ? existing.baseBranch.trim() : "main",
        channelSystemMessage: existing?.channelSystemMessage ?? "",
      };
    });
}

export const discoverLarkWorkspace = async (
  larkAppKey: string,
  larkAppSecret: string
): Promise<DashboardConfig["workspaces"][number]> => {
  const appId = larkAppKey.trim();
  const appSecret = larkAppSecret.trim();
  if (!appId) {
    throw new Error("Missing Lark app key");
  }
  if (!appSecret) {
    throw new Error("Missing Lark app secret");
  }

  const config = await readLocalSettings();
  const tenantAccessToken = await getLarkTenantAccessToken(appId, appSecret);
  let botInfo: LarkBotInfoResponse = {};
  let tenantInfo: LarkTenantInfoResponse = {};
  let chatsResult: LarkChatListResponse = {};
  try {
    botInfo = await larkAuthedRequest<LarkBotInfoResponse>(tenantAccessToken, "/open-apis/bot/v3/info");
  } catch {
    botInfo = {};
  }
  try {
    tenantInfo = await larkAuthedRequest<LarkTenantInfoResponse>(
      tenantAccessToken,
      "/open-apis/tenant/v2/tenant/query"
    );
  } catch {
    tenantInfo = {};
  }
  try {
    chatsResult = await larkAuthedRequest<LarkChatListResponse>(
      tenantAccessToken,
      "/open-apis/im/v1/chats?page_size=100"
    );
  } catch {
    chatsResult = {};
  }
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const channelDetails = buildLarkChannelDetails(chatsResult.data?.items ?? [], null, fallbackModel);
  const workspaceName =
    tenantInfo.tenant?.name?.trim()
    || botInfo.bot?.app_name?.trim()
    || `Lark ${appId.slice(0, 8)}`;

  return {
    id: `lark-${appId}`,
    type: "lark",
    name: workspaceName,
    domain: "larksuite.com",
    status: "active",
    channels: channelDetails.length,
    members: 0,
    lastSync: new Date().toISOString(),
    larkAppKey: appId,
    larkAppId: appId,
    larkAppSecret: appSecret,
    channelDetails,
  };
};

export const syncLarkWorkspace = async (workspaceId: string): Promise<DashboardConfig["workspaces"][number]> => {
  const config = await readLocalSettings();
  const workspaceIndex = config.workspaces.findIndex((item) => item.id === workspaceId);
  if (workspaceIndex === -1) {
    throw new Error("Workspace not found");
  }

  const workspace = config.workspaces[workspaceIndex]!;
  if (workspace.type !== "lark") {
    throw new Error("Workspace is not Lark type");
  }

  const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim() || "";
  const appSecret = workspace.larkAppSecret?.trim() ?? "";
  if (!appId || !appSecret) {
    throw new Error("Missing Lark app credentials");
  }

  const token = await getLarkTenantAccessToken(appId, appSecret);
  let tenantInfo: LarkTenantInfoResponse = {};
  try {
    tenantInfo = await larkAuthedRequest<LarkTenantInfoResponse>(token, "/open-apis/tenant/v2/tenant/query");
  } catch {
    tenantInfo = {};
  }
  let chatsResult: LarkChatListResponse = {};
  try {
    chatsResult = await larkAuthedRequest<LarkChatListResponse>(token, "/open-apis/im/v1/chats?page_size=100");
  } catch {
    chatsResult = {};
  }
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const channelDetails = buildLarkChannelDetails(chatsResult.data?.items ?? [], workspace, fallbackModel);

  const updatedWorkspace: DashboardConfig["workspaces"][number] = {
    ...workspace,
    type: "lark",
    name: tenantInfo.tenant?.name?.trim() || workspace.name,
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

export const syncDiscordWorkspace = async (workspaceId: string): Promise<DashboardConfig["workspaces"][number]> => {
  const config = await readLocalSettings();
  const workspaceIndex = config.workspaces.findIndex((item) => item.id === workspaceId);
  if (workspaceIndex === -1) {
    throw new Error("Workspace not found");
  }

  const workspace = config.workspaces[workspaceIndex]!;
  if (workspace.type !== "discord") {
    throw new Error("Workspace is not Discord type");
  }

  const botToken = workspace.discordBotToken?.trim() ?? "";
  if (!botToken) {
    throw new Error("Missing Discord bot token");
  }

  const snapshot = await fetchDiscordWorkspaceSnapshot(botToken);
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const channelDetails = buildDiscordChannelDetails(snapshot.channels, workspace, fallbackModel);

  const updatedWorkspace: DashboardConfig["workspaces"][number] = {
    ...workspace,
    type: "discord",
    name: snapshot.guild.name || workspace.name,
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

export const syncSlackWorkspace = async (workspaceId: string): Promise<DashboardConfig["workspaces"][number]> => {
  const config = await readLocalSettings();
  const workspaceIndex = config.workspaces.findIndex((item) => item.id === workspaceId);
  if (workspaceIndex === -1) {
    throw new Error("Workspace not found");
  }

  const workspace = config.workspaces[workspaceIndex]!;
  if (workspace.type !== "slack") {
    throw new Error("Workspace is not Slack type");
  }
  const botToken = workspace.slackBotToken?.trim() ?? "";
  if (!botToken) {
    throw new Error("Missing Slack bot token");
  }

  const snapshot = await fetchSlackWorkspaceSnapshot(botToken);
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const channelDetails = buildSyncedChannelDetails(snapshot.channels, workspace, fallbackModel);

  const updatedWorkspace: DashboardConfig["workspaces"][number] = {
    ...workspace,
    type: "slack",
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
