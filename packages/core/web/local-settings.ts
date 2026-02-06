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
    return sanitizeDashboardConfig(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return defaultDashboardConfig;
    }
    return defaultDashboardConfig;
  }
};

export const writeLocalSettings = async (config: DashboardConfig): Promise<void> => {
  await mkdir(configDir, { recursive: true });
  let existingRaw: Record<string, unknown> | null = null;
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      existingRaw = parsed as Record<string, unknown>;
    }
  } catch {
    existingRaw = null;
  }

  const persisted: Record<string, unknown> = { ...config };
  if (existingRaw && Object.prototype.hasOwnProperty.call(existingRaw, "devServer")) {
    persisted.devServer = existingRaw.devServer;
  }
  if (existingRaw && Object.prototype.hasOwnProperty.call(existingRaw, "devServers")) {
    persisted.devServers = existingRaw.devServers;
  }

  await writeFile(configPath, JSON.stringify(persisted, null, 2));
};

type SlackChannel = {
  id: string;
  name: string;
};

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
    channels.push(...(data.channels ?? []));
    cursor = data.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return channels;
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

  const teamInfo = await slackRequest<{ team: { name?: string; domain?: string } }>(
    botToken,
    "team.info"
  );
  const slackChannels = await fetchSlackChannels(botToken);
  const fallbackModel = config.agents.opencode.models[0] ?? "";

  const channelDetails = slackChannels.map((channel) => {
    const existing = workspace.channelDetails.find((item) => item.id === channel.id);
    const agentProvider: "opencode" | "claudecode" | "codex" =
      existing?.agentProvider === "claudecode"
        ? "claudecode"
        : existing?.agentProvider === "codex"
          ? "codex"
          : "opencode";
    return {
      id: channel.id,
      name: channel.name ? `#${channel.name}` : "",
      agentProvider,
      model: existing?.model ?? (agentProvider === "opencode" || agentProvider === "codex" ? fallbackModel : ""),
      workingDirectory: existing?.workingDirectory ?? "",
    };
  });

  const updatedWorkspace: DashboardConfig["workspaces"][number] = {
    ...workspace,
    name: teamInfo.team?.name ?? workspace.name,
    domain: teamInfo.team?.domain ? `${teamInfo.team.domain}.slack.com` : workspace.domain,
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
