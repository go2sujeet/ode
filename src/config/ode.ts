import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";
import { normalizeCwd } from "./paths";

const XDG_CONFIG_HOME = join(homedir(), ".config");
const ODE_CONFIG_DIR = join(XDG_CONFIG_HOME, "ode");
export const ODE_CONFIG_FILE = join(ODE_CONFIG_DIR, "ode.json");

const userSchema = z.object({
  name: z.string(),
  email: z.string(),
  initials: z.string(),
  avatar: z.string().optional(),
  githubToken: z.string().optional(),
  defaultMessageFrequency: z.enum(["low", "medium", "high"]).optional(),
});

const devServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  models: z.array(z.string()),
});

const channelDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
  workingDirectory: z.string().optional(),
  devServerId: z.string(),
});

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  status: z.string(),
  channels: z.number(),
  members: z.number(),
  lastSync: z.string(),
  slackAppToken: z.string().startsWith("xapp-"),
  slackBotToken: z.string().startsWith("xoxb-"),
  channelDetails: z.array(channelDetailSchema),
});

const odeConfigSchema = z.object({
  user: userSchema,
  devServers: z.array(devServerSchema),
  workspaces: z.array(workspaceSchema),
});

export type ChannelDetail = z.infer<typeof channelDetailSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceSchema>;
export type DevServerConfig = z.infer<typeof devServerSchema>;
export type OdeConfig = z.infer<typeof odeConfigSchema>;
export type UserConfig = z.infer<typeof userSchema>;

let cachedConfig: OdeConfig | null = null;

const EMPTY_TEMPLATE: OdeConfig = {
  user: {
    name: "",
    email: "",
    initials: "",
    avatar: "",
    githubToken: "",
    defaultMessageFrequency: "medium",
  },
  devServers: [],
  workspaces: [],
};

function ensureConfigDir(): void {
  if (!existsSync(ODE_CONFIG_DIR)) {
    mkdirSync(ODE_CONFIG_DIR, { recursive: true });
  }
}

function ensureConfigFile(): void {
  if (existsSync(ODE_CONFIG_FILE)) return;
  ensureConfigDir();
  writeFileSync(ODE_CONFIG_FILE, JSON.stringify(EMPTY_TEMPLATE, null, 2));
}

function normalizeConfig(config: OdeConfig): OdeConfig {
  return config;
}

export function loadOdeConfig(): OdeConfig {
  if (cachedConfig) return cachedConfig;

  ensureConfigFile();

  if (!existsSync(ODE_CONFIG_FILE)) {
    cachedConfig = normalizeConfig(EMPTY_TEMPLATE);
    return cachedConfig;
  }

  try {
    const raw = readFileSync(ODE_CONFIG_FILE, "utf-8");
    const parsed = odeConfigSchema.safeParse(JSON.parse(raw));
    cachedConfig = parsed.success
      ? normalizeConfig(parsed.data ?? EMPTY_TEMPLATE)
      : normalizeConfig(EMPTY_TEMPLATE);
    return cachedConfig;
  } catch {
    cachedConfig = normalizeConfig(EMPTY_TEMPLATE);
    return cachedConfig;
  }
}

export function invalidateOdeConfigCache(): void {
  cachedConfig = null;
}

export function saveOdeConfig(config: OdeConfig): void {
  ensureConfigDir();
  cachedConfig = normalizeConfig(config);
  writeFileSync(ODE_CONFIG_FILE, JSON.stringify(cachedConfig, null, 2));
}

export function getWorkspaces(): WorkspaceConfig[] {
  return loadOdeConfig().workspaces;
}

export function getDevServers(): DevServerConfig[] {
  return loadOdeConfig().devServers;
}

export function getSlackAppToken(): string {
  const active = getWorkspaces().filter((workspace) => workspace.status === "active");
  const candidates = active.length > 0 ? active : getWorkspaces();
  const tokens = Array.from(new Set(candidates.map((w) => w.slackAppToken).filter(Boolean)));
  if (tokens.length === 0) {
    throw new Error("Slack app token missing in ~/.config/ode/ode.json");
  }
  if (tokens.length > 1) {
    throw new Error("Multiple Slack app tokens found; expected one shared token");
  }
  return tokens[0]!;
}

export function getSlackBotTokens(): Array<{ token: string; workspaceName?: string }> {
  const active = getWorkspaces().filter((workspace) => workspace.status === "active");
  const candidates = active.length > 0 ? active : getWorkspaces();
  return candidates.map((workspace) => ({
    token: workspace.slackBotToken,
    workspaceName: workspace.name,
  }));
}

export function getSlackTargetChannels(): string[] | null {
  const channels = getWorkspaces().flatMap((workspace) => workspace.channelDetails);
  const ids = channels.map((channel) => channel.id).filter(Boolean);
  return ids.length > 0 ? ids : null;
}

export function getDefaultCwd(): string {
  return normalizeCwd(process.cwd());
}

export function getDefaultOpenCodeServerUrl(): string {
  const servers = getDevServers();
  if (servers.length === 0) {
    throw new Error("No dev servers configured in ~/.config/ode/ode.json");
  }
  const url = servers[0]?.url;
  if (!url) {
    throw new Error("Dev server URL missing in ~/.config/ode/ode.json");
  }
  return url;
}

export function getChannelDetails(channelId: string): ChannelDetail | null {
  for (const workspace of getWorkspaces()) {
    const match = workspace.channelDetails.find((channel) => channel.id === channelId);
    if (match) return match;
  }
  return null;
}

export function getChannelWorkingDirectory(channelId: string): string | null {
  const channel = getChannelDetails(channelId);
  const workingDirectory = channel?.workingDirectory?.trim();
  return workingDirectory && workingDirectory.length > 0 ? workingDirectory : null;
}

export function getChannelCwd(channelId: string): string {
  const workingDirectory = getChannelWorkingDirectory(channelId);
  if (workingDirectory) return normalizeCwd(workingDirectory);
  return getDefaultCwd();
}

export function setChannelCwd(channelId: string, cwd: string): void {
  updateChannel(channelId, (channel) => ({
    ...channel,
    workingDirectory: normalizeCwd(cwd),
  }));
}

export function setChannelWorkingDirectory(channelId: string, workingDirectory: string | null): void {
  const normalized = workingDirectory && workingDirectory.trim().length > 0
    ? normalizeCwd(workingDirectory)
    : undefined;
  updateChannel(channelId, (channel) => ({
    ...channel,
    workingDirectory: normalized,
  }));
}

export function getChannelModel(channelId: string): string | null {
  return getChannelDetails(channelId)?.model ?? null;
}

export function getChannelDevServerId(channelId: string): string | null {
  return getChannelDetails(channelId)?.devServerId ?? null;
}

export function getChannelOpenCodeServerUrl(channelId: string): string | undefined {
  const channel = getChannelDetails(channelId);
  if (!channel) return undefined;
  const server = getDevServers().find((entry) => entry.id === channel.devServerId);
  return server?.url;
}

export function setChannelModel(channelId: string, model: string): void {
  updateChannel(channelId, (channel) => ({ ...channel, model }));
}

export function setChannelDevServerId(channelId: string, devServerId: string): void {
  updateChannel(channelId, (channel) => ({ ...channel, devServerId }));
}

function updateChannel(
  channelId: string,
  updater: (channel: ChannelDetail) => ChannelDetail
): void {
  const config = loadOdeConfig();
  let found = false;
  const workspaces = config.workspaces.map((workspace) => {
    const channelDetails = workspace.channelDetails.map((channel) => {
      if (channel.id !== channelId) return channel;
      found = true;
      return updater(channel);
    });
    return { ...workspace, channelDetails };
  });

  if (!found) {
    throw new Error("Channel not found in ~/.config/ode/ode.json");
  }

  saveOdeConfig({ ...config, workspaces });
}
