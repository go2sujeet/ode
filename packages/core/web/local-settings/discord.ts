import {
  readDashboardConfig,
  updateDashboardConfig,
} from "@/config";
import { normalizeChannelAgentProvider, resolveFallbackModel, type WorkspaceConfig } from "./shared";

type DiscordGuild = {
  id: string;
  name: string;
};

type DiscordChannel = {
  id: string;
  type: number;
  name?: string;
};

const DISCORD_TEXT_CHANNEL_TYPES = new Set([0, 5, 15]);

const discordRequest = async <T>(token: string, path: string): Promise<T> => {
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
  workspace: WorkspaceConfig | null,
  fallbackModel: string
): WorkspaceConfig["channelDetails"] {
  return channels.map((channel) => {
    const existing = workspace?.channelDetails.find((item) => item.id === channel.id);
    const agentProvider = normalizeChannelAgentProvider(existing?.agentProvider);
    return {
      id: channel.id,
      name: channel.name || channel.id,
      agentProvider,
      model: existing?.model ?? resolveFallbackModel(agentProvider, fallbackModel),
      workingDirectory: existing?.workingDirectory ?? "",
      baseBranch: existing?.baseBranch?.trim() ? existing.baseBranch.trim() : "main",
      channelSystemMessage: existing?.channelSystemMessage ?? "",
    };
  });
}

export const discoverDiscordWorkspace = async (
  discordBotToken: string
): Promise<WorkspaceConfig> => {
  const botToken = discordBotToken.trim();
  if (!botToken) {
    throw new Error("Missing Discord bot token");
  }

  const config = readDashboardConfig();
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

export const syncDiscordWorkspace = async (workspaceId: string): Promise<WorkspaceConfig> => {
  const config = readDashboardConfig();
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

  const updatedWorkspace: WorkspaceConfig = {
    ...workspace,
    type: "discord",
    name: snapshot.guild.name || workspace.name,
    channels: channelDetails.length,
    lastSync: new Date().toISOString(),
    channelDetails,
  };

  updateDashboardConfig((current) => ({
    ...current,
    workspaces: current.workspaces.map((item, index) =>
      index === workspaceIndex ? updatedWorkspace : item
    ),
  }));
  return updatedWorkspace;
};
