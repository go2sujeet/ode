import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { normalizeCwd } from "../paths";
import {
  sanitizeDashboardConfig,
  type DashboardConfig,
} from "../dashboard-config";
import {
  DEFAULT_STATUS_MESSAGE_FREQUENCY_MS,
  parseStatusMessageFrequencyMs,
  type StatusMessageFrequencyMs,
} from "../status-message-frequency";
import {
  odeConfigSchema,
  type ChannelDetail,
  type WorkspaceConfig,
  type AgentProvider,
  type AgentsConfig,
  type UpdateConfig,
  type OdeConfig,
  type UserConfig,
} from "./ode-schema";
import { isAgentProviderId } from "@/shared/agent-provider";

export type {
  ChannelDetail,
  WorkspaceConfig,
  AgentProvider,
  AgentsConfig,
  UpdateConfig,
  OdeConfig,
  UserConfig,
} from "./ode-schema";

const existsSync = fs.existsSync;
const mkdirSync = fs.mkdirSync;
const readFileSync = fs.readFileSync;
const writeFileSync = fs.writeFileSync;
const join = typeof path.join === "function" ? path.join : (...parts: string[]) => parts.join("/");
const homedir = typeof os.homedir === "function" ? os.homedir : () => "";

const XDG_CONFIG_HOME = join(homedir(), ".config");
const ODE_CONFIG_DIR = join(XDG_CONFIG_HOME, "ode");
export const ODE_CONFIG_FILE = join(ODE_CONFIG_DIR, "ode.json");

const DEFAULT_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const MIN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MESSAGE_UPDATE_INTERVAL_MS = DEFAULT_STATUS_MESSAGE_FREQUENCY_MS;
const MIN_MESSAGE_UPDATE_INTERVAL_MS = 250;
export const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";

let cachedConfig: OdeConfig | null = null;

const EMPTY_TEMPLATE: OdeConfig = {
  user: {
    name: "",
    email: "",
    initials: "",
    avatar: "",
    gitStrategy: "worktree",
    defaultStatusMessageFormat: "medium",
    IM_MESSAGE_UPDATE_INTERVAL_MS: DEFAULT_STATUS_MESSAGE_FREQUENCY_MS,
  },
  githubInfos: {},
  agents: {
    opencode: { enabled: true, models: [] },
    claudecode: { enabled: true },
    codex: { enabled: true, models: [] },
    kimi: { enabled: true },
    kiro: { enabled: true },
    kilo: { enabled: true, models: [] },
    qwen: { enabled: true },
    goose: { enabled: true },
    gemini: { enabled: true },
  },
  completeOnboarding: false,
  workspaces: [],
  updates: {
    autoUpgrade: true,
    checkIntervalMs: DEFAULT_UPDATE_INTERVAL_MS,
  },
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

function normalizeBaseBranch(baseBranch: string | null | undefined): string {
  const normalized = baseBranch?.trim();
  return normalized && normalized.length > 0 ? normalized : "main";
}

function normalizeConfig(config: OdeConfig): OdeConfig {
  const {
    defaultMessageFrequency: _deprecatedMessageFrequency,
    messageUpdateIntervalMs: _deprecatedMessageUpdateIntervalMs,
    ...normalizedUser
  } = config.user;
  const statusMessageFormat = config.user.defaultStatusMessageFormat
    ?? config.user.defaultMessageFrequency
    ?? "medium";
  const normalizedFrequency =
    statusMessageFormat === "low"
      ? "minimum"
      : statusMessageFormat === "high"
        ? "aggressive"
        : statusMessageFormat;
  const normalizedGitStrategy =
    config.user.gitStrategy === "default" ? "default" : "worktree";
  const messageUpdateIntervalCandidate =
    config.user.IM_MESSAGE_UPDATE_INTERVAL_MS
    ?? config.user.messageUpdateIntervalMs
    ?? DEFAULT_MESSAGE_UPDATE_INTERVAL_MS;
  const normalizedMessageUpdateInterval =
    Number.isFinite(messageUpdateIntervalCandidate) && messageUpdateIntervalCandidate > 0
      ? Math.max(messageUpdateIntervalCandidate, MIN_MESSAGE_UPDATE_INTERVAL_MS)
      : DEFAULT_MESSAGE_UPDATE_INTERVAL_MS;
  const intervalCandidate = config.updates?.checkIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS;
  const normalizedInterval =
    Number.isFinite(intervalCandidate) && intervalCandidate > 0
      ? Math.max(intervalCandidate, MIN_UPDATE_INTERVAL_MS)
      : DEFAULT_UPDATE_INTERVAL_MS;
  const autoUpgrade = config.updates?.autoUpgrade ?? true;
  const opencodeModels = Array.from(new Set((config.agents?.opencode?.models ?? [])
    .map((model) => model.trim())
    .filter(Boolean)));
  const codexModels = Array.from(new Set((config.agents?.codex?.models ?? [])
    .map((model) => model.trim())
    .filter(Boolean)));
  const kiloModels = Array.from(new Set((config.agents?.kilo?.models ?? [])
    .map((model) => model.trim())
    .filter(Boolean)));
  const completeOnboarding = config.completeOnboarding === true;
  const workspaces = config.workspaces.map((workspace) => ({
    ...workspace,
    type:
      workspace.type === "discord"
        ? "discord" as const
        : workspace.type === "lark"
          ? "lark" as const
          : "slack" as const,
    channelDetails: workspace.channelDetails.map((channel) => ({
      ...channel,
      baseBranch: normalizeBaseBranch(channel.baseBranch),
    })),
  }));
  return {
    ...config,
    user: {
      ...normalizedUser,
      gitStrategy: normalizedGitStrategy,
      defaultStatusMessageFormat: normalizedFrequency,
      IM_MESSAGE_UPDATE_INTERVAL_MS: normalizedMessageUpdateInterval,
    },
    updates: {
      autoUpgrade,
      checkIntervalMs: normalizedInterval,
    },
    agents: {
      opencode: {
        enabled: config.agents?.opencode?.enabled ?? true,
        models: opencodeModels,
      },
      claudecode: {
        enabled: config.agents?.claudecode?.enabled ?? true,
      },
      codex: {
        enabled: config.agents?.codex?.enabled ?? true,
        models: codexModels,
      },
      kimi: {
        enabled: config.agents?.kimi?.enabled ?? true,
      },
      kiro: {
        enabled: config.agents?.kiro?.enabled ?? true,
      },
      kilo: {
        enabled: config.agents?.kilo?.enabled ?? true,
        models: kiloModels,
      },
      qwen: {
        enabled: config.agents?.qwen?.enabled ?? true,
      },
      goose: {
        enabled: config.agents?.goose?.enabled ?? true,
      },
      gemini: {
        enabled: config.agents?.gemini?.enabled ?? true,
      },
    },
    completeOnboarding,
    workspaces,
  };
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
    const parsedJson = JSON.parse(raw) as Record<string, unknown>;
    const parsed = odeConfigSchema.safeParse(parsedJson);
    const base = parsed.success ? parsed.data : EMPTY_TEMPLATE;
    cachedConfig = normalizeConfig(base);
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

export function updateOdeConfig(updater: (config: OdeConfig) => OdeConfig): OdeConfig {
  const next = updater(structuredClone(loadOdeConfig()));
  saveOdeConfig(next);
  return loadOdeConfig();
}

function toDashboardConfig(config: OdeConfig): DashboardConfig {
  const defaultStatusMessageFormat =
    config.user.defaultStatusMessageFormat === "aggressive" || config.user.defaultStatusMessageFormat === "minimum"
      ? config.user.defaultStatusMessageFormat
      : "medium";

  return {
    completeOnboarding: config.completeOnboarding,
    user: {
      name: config.user.name,
      email: config.user.email,
      initials: config.user.initials,
      avatar: config.user.avatar,
      gitStrategy: config.user.gitStrategy,
      defaultStatusMessageFormat,
      statusMessageFrequencyMs: parseStatusMessageFrequencyMs(config.user.IM_MESSAGE_UPDATE_INTERVAL_MS),
    },
    updates: {
      autoUpgrade: config.updates.autoUpgrade,
    },
    agents: structuredClone(config.agents),
    workspaces: structuredClone(config.workspaces),
  };
}

function mergeDashboardConfig(config: OdeConfig, dashboardConfig: DashboardConfig): OdeConfig {
  const {
    statusMessageFrequencyMs,
    ...dashboardUser
  } = dashboardConfig.user;
  const workspaces: WorkspaceConfig[] = dashboardConfig.workspaces.map((workspace) => ({
    ...workspace,
    slackAppToken: workspace.slackAppToken ?? "",
    slackBotToken: workspace.slackBotToken ?? "",
    discordBotToken: workspace.discordBotToken ?? "",
    larkAppKey: workspace.larkAppKey ?? workspace.larkAppId ?? "",
    larkAppId: workspace.larkAppId ?? workspace.larkAppKey ?? "",
    larkAppSecret: workspace.larkAppSecret ?? "",
    channelDetails: workspace.channelDetails.map((channel) => ({
      ...channel,
      agentProvider: channel.agentProvider ?? "opencode",
      channelSystemMessage: channel.channelSystemMessage ?? "",
    })),
  }));

  return {
    ...config,
    completeOnboarding: dashboardConfig.completeOnboarding,
    user: {
      ...config.user,
      ...dashboardUser,
      IM_MESSAGE_UPDATE_INTERVAL_MS: parseStatusMessageFrequencyMs(statusMessageFrequencyMs),
    },
    updates: {
      ...config.updates,
      autoUpgrade: dashboardConfig.updates.autoUpgrade !== false,
    },
    agents: structuredClone(dashboardConfig.agents),
    workspaces,
  };
}

export function readDashboardConfig(): DashboardConfig {
  return sanitizeDashboardConfig(toDashboardConfig(loadOdeConfig()));
}

export function writeDashboardConfig(config: DashboardConfig): DashboardConfig {
  const sanitized = sanitizeDashboardConfig(config);
  updateOdeConfig((current) => mergeDashboardConfig(current, sanitized));
  return readDashboardConfig();
}

export function updateDashboardConfig(
  updater: (config: DashboardConfig) => DashboardConfig
): DashboardConfig {
  const next = updater(readDashboardConfig());
  return writeDashboardConfig(next);
}

export function getWorkspaces(): WorkspaceConfig[] {
  return loadOdeConfig().workspaces;
}

export function getAgentsConfig(): AgentsConfig {
  return loadOdeConfig().agents;
}

export function getEnabledAgentProviders(): AgentProvider[] {
  const agents = getAgentsConfig();
  const enabled: AgentProvider[] = [];
  if (agents.opencode.enabled) enabled.push("opencode");
  if (agents.claudecode.enabled) enabled.push("claudecode");
  if (agents.codex.enabled) enabled.push("codex");
  if (agents.kimi.enabled) enabled.push("kimi");
  if (agents.kiro.enabled) enabled.push("kiro");
  if (agents.kilo.enabled) enabled.push("kilo");
  if (agents.qwen.enabled) enabled.push("qwen");
  if (agents.goose.enabled) enabled.push("goose");
  if (agents.gemini.enabled) enabled.push("gemini");
  return enabled.length > 0 ? enabled : ["opencode"];
}

export function isAgentEnabled(agentProvider: AgentProvider): boolean {
  const agents = getAgentsConfig();
  if (agentProvider === "opencode") return agents.opencode.enabled;
  if (agentProvider === "claudecode") return agents.claudecode.enabled;
  if (agentProvider === "codex") return agents.codex.enabled;
  if (agentProvider === "kimi") return agents.kimi.enabled;
  if (agentProvider === "kiro") return agents.kiro.enabled;
  if (agentProvider === "kilo") return agents.kilo.enabled;
  if (agentProvider === "qwen") return agents.qwen.enabled;
  if (agentProvider === "goose") return agents.goose.enabled;
  return agents.gemini.enabled;
}

export function getOpenCodeModels(): string[] {
  return getAgentsConfig().opencode.models;
}

export function setOpenCodeModels(models: string[]): void {
  updateOdeConfig((config) => ({
    ...config,
    agents: {
      ...config.agents,
      opencode: {
        ...config.agents.opencode,
        models,
      },
    },
  }));
}

export function getCodexModels(): string[] {
  return getAgentsConfig().codex.models;
}

export function setCodexModels(models: string[]): void {
  updateOdeConfig((config) => ({
    ...config,
    agents: {
      ...config.agents,
      codex: {
        ...config.agents.codex,
        models,
      },
    },
  }));
}

export function getKiloModels(): string[] {
  return getAgentsConfig().kilo.models ?? [];
}

export function setKiloModels(models: string[]): void {
  updateOdeConfig((config) => ({
    ...config,
    agents: {
      ...config.agents,
      kilo: {
        ...config.agents.kilo,
        models,
      },
    },
  }));
}

export function getUpdateConfig(): UpdateConfig {
  return loadOdeConfig().updates;
}

export function getSlackAppTokens(): Array<{ token: string; workspaceId: string; workspaceName?: string }> {
  const active = getWorkspaces().filter((workspace) => workspace.type === "slack" && workspace.status === "active");
  const candidates = active.length > 0 ? active : getWorkspaces().filter((workspace) => workspace.type === "slack");
  return candidates
    .map((workspace) => ({
      token: workspace.slackAppToken,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }))
    .filter((entry) => entry.token && entry.token.trim().length > 0);
}

export function getSlackBotTokens(): Array<{
  token: string;
  appToken: string;
  workspaceId: string;
  workspaceName?: string;
}> {
  const active = getWorkspaces().filter((workspace) => workspace.type === "slack" && workspace.status === "active");
  const candidates = active.length > 0 ? active : getWorkspaces().filter((workspace) => workspace.type === "slack");
  return candidates.map((workspace) => ({
    token: workspace.slackBotToken,
    appToken: workspace.slackAppToken,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
  }));
}

export function getSlackTargetChannels(): string[] | null {
  const channels = getWorkspaces()
    .filter((workspace) => workspace.type === "slack")
    .flatMap((workspace) => workspace.channelDetails);
  const ids = channels.map((channel) => channel.id).filter(Boolean);
  return ids.length > 0 ? ids : null;
}

export function getDiscordBotTokens(): Array<{ token: string; workspaceId: string; workspaceName?: string }> {
  const active = getWorkspaces().filter((workspace) => workspace.type === "discord" && workspace.status === "active");
  const candidates = active.length > 0 ? active : getWorkspaces().filter((workspace) => workspace.type === "discord");
  return candidates
    .map((workspace) => ({
      token: workspace.discordBotToken,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }))
    .filter((entry) => entry.token && entry.token.trim().length > 0);
}

export function getDiscordTargetChannels(): string[] | null {
  const channels = getWorkspaces()
    .filter((workspace) => workspace.type === "discord")
    .flatMap((workspace) => workspace.channelDetails);
  const ids = channels.map((channel) => channel.id).filter(Boolean);
  return ids.length > 0 ? ids : null;
}

export function getLarkAppCredentials(): Array<{
  appId: string;
  appSecret: string;
  workspaceId: string;
  workspaceName?: string;
}> {
  const active = getWorkspaces().filter((workspace) => workspace.type === "lark" && workspace.status === "active");
  const candidates = active.length > 0 ? active : getWorkspaces().filter((workspace) => workspace.type === "lark");
  return candidates
    .map((workspace) => ({
      appId: workspace.larkAppKey?.trim() || workspace.larkAppId?.trim() || "",
      appSecret: workspace.larkAppSecret?.trim() ?? "",
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    }))
    .filter((entry) => entry.appId.length > 0 && entry.appSecret.length > 0);
}

export function getLarkTargetChannels(): string[] | null {
  const channels = getWorkspaces()
    .filter((workspace) => workspace.type === "lark")
    .flatMap((workspace) => workspace.channelDetails);
  const ids = channels.map((channel) => channel.id).filter(Boolean);
  return ids.length > 0 ? ids : null;
}

export function getDefaultCwd(): string {
  return normalizeCwd(process.cwd());
}

export function getChannelDetails(channelId: string): ChannelDetail | null {
  for (const workspace of getWorkspaces()) {
    const match = workspace.channelDetails.find((channel) => channel.id === channelId);
    if (match) return match;
  }
  return null;
}

export type GitHubInfo = {
  token?: string;
  gitName?: string;
  gitEmail?: string;
};

export type UserGeneralSettings = {
  defaultStatusMessageFormat: "minimum" | "medium" | "aggressive";
  gitStrategy: "default" | "worktree";
  statusMessageFrequencyMs: StatusMessageFrequencyMs;
  autoUpdate: boolean;
};

export function getGitHubInfoForUser(userId: string): GitHubInfo | null {
  const info = loadOdeConfig().githubInfos?.[userId];
  if (!info) return null;
  const token = info.token?.trim() || "";
  const gitName = info.gitName?.trim() || "";
  const gitEmail = info.gitEmail?.trim() || "";
  if (!token && !gitName && !gitEmail) return null;
  return {
    token: token || undefined,
    gitName: gitName || undefined,
    gitEmail: gitEmail || undefined,
  };
}

export function getUserGeneralSettings(): UserGeneralSettings {
  const odeConfig = loadOdeConfig();
  const user = odeConfig.user;
  const updates = odeConfig.updates;
  return {
    defaultStatusMessageFormat:
      user.defaultStatusMessageFormat === "minimum" || user.defaultStatusMessageFormat === "aggressive"
        ? user.defaultStatusMessageFormat
        : "medium",
    gitStrategy: user.gitStrategy === "default" ? "default" : "worktree",
    statusMessageFrequencyMs: parseStatusMessageFrequencyMs(user.IM_MESSAGE_UPDATE_INTERVAL_MS),
    autoUpdate: updates.autoUpgrade !== false,
  };
}

export function setUserGeneralSettings(settings: UserGeneralSettings): void {
  updateOdeConfig((config) => ({
    ...config,
    user: {
      ...config.user,
      defaultStatusMessageFormat: settings.defaultStatusMessageFormat,
      gitStrategy: settings.gitStrategy,
      IM_MESSAGE_UPDATE_INTERVAL_MS: parseStatusMessageFrequencyMs(settings.statusMessageFrequencyMs),
    },
    updates: {
      ...config.updates,
      autoUpgrade: settings.autoUpdate !== false,
    },
  }));
}

export function setGitHubInfoForUser(userId: string, info: GitHubInfo): void {
  updateOdeConfig((config) => {
    const githubInfos = { ...(config.githubInfos ?? {}) };
    const token = info.token?.trim() || "";
    const gitName = info.gitName?.trim() || "";
    const gitEmail = info.gitEmail?.trim() || "";
    if (!token && !gitName && !gitEmail) {
      delete githubInfos[userId];
    } else {
      githubInfos[userId] = {
        token,
        gitName,
        gitEmail,
      };
    }
    return { ...config, githubInfos };
  });
}

export function clearGitHubInfoForUser(userId: string): void {
  updateOdeConfig((config) => {
    const githubInfos = { ...(config.githubInfos ?? {}) };
    delete githubInfos[userId];
    return { ...config, githubInfos };
  });
}

export type ChannelCwdInfo = {
  cwd: string;
  workingDirectory: string | null;
  hasCustomCwd: boolean;
};

export function resolveChannelCwd(channelId: string): ChannelCwdInfo {
  const channel = getChannelDetails(channelId);
  const workingDirectory = channel?.workingDirectory?.trim();
  const normalized = workingDirectory && workingDirectory.length > 0
    ? normalizeCwd(workingDirectory)
    : null;
  return {
    cwd: normalized ?? getDefaultCwd(),
    workingDirectory: normalized,
    hasCustomCwd: Boolean(normalized),
  };
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
    : "";
  updateChannel(channelId, (channel) => ({
    ...channel,
    workingDirectory: normalized,
  }));
}

export function getChannelBaseBranch(channelId: string): string {
  return normalizeBaseBranch(getChannelDetails(channelId)?.baseBranch);
}

export function setChannelBaseBranch(channelId: string, baseBranch: string | null): void {
  const normalized = normalizeBaseBranch(baseBranch);
  updateChannel(channelId, (channel) => ({
    ...channel,
    baseBranch: normalized,
  }));
}

export function getChannelSystemMessage(channelId: string): string | null {
  return getChannelDetails(channelId)?.channelSystemMessage ?? null;
}

export function setChannelSystemMessage(channelId: string, channelSystemMessage: string | null): void {
  const normalized = channelSystemMessage?.trim() ?? "";
  updateChannel(channelId, (channel) => ({
    ...channel,
    channelSystemMessage: normalized,
  }));
}

export function getChannelModel(channelId: string): string | null {
  return getChannelDetails(channelId)?.model ?? null;
}

export function getChannelAgentProvider(channelId: string): AgentProvider {
  const provider = getChannelDetails(channelId)?.agentProvider;
  return isAgentProviderId(provider) ? provider : "opencode";
}

export function setChannelModel(channelId: string, model: string): void {
  updateChannel(channelId, (channel) => ({ ...channel, model }));
}

export function setChannelAgentProvider(
  channelId: string,
  agentProvider: AgentProvider
): void {
  updateChannel(channelId, (channel) => ({ ...channel, agentProvider }));
}

function updateChannel(
  channelId: string,
  updater: (channel: ChannelDetail) => ChannelDetail
): void {
  let updated = false;
  updateOdeConfig((config) => {
    const workspaces = config.workspaces.map((workspace) => {
      const channelDetails = workspace.channelDetails.map((channel) => {
        if (channel.id !== channelId) return channel;
        updated = true;
        return updater(channel);
      });
      return { ...workspace, channelDetails };
    });

    if (!updated) {
      throw new Error("Channel not found in ~/.config/ode/ode.json");
    }

    return { ...config, workspaces };
  });
}
