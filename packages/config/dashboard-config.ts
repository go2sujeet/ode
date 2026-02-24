import {
  DEFAULT_STATUS_MESSAGE_FREQUENCY_MS,
  parseStatusMessageFrequencyMs,
  type StatusMessageFrequencyMs,
} from "./status-message-frequency";
import { isAgentProviderId, type AgentProviderId } from "@/shared/agent-provider";

export type DashboardConfig = {
  completeOnboarding: boolean;
  user: {
    name: string;
    email: string;
    initials?: string;
    avatar?: string;
    gitStrategy: "default" | "worktree";
    defaultStatusMessageFormat: "aggressive" | "medium" | "minimum";
    defaultMessageFrequency?: "aggressive" | "medium" | "minimum";
    statusMessageFrequencyMs?: StatusMessageFrequencyMs;
  };
  updates: {
    autoUpgrade: boolean;
  };
  agents: {
    opencode: {
      enabled: boolean;
      models: string[];
    };
    claudecode: {
      enabled: boolean;
    };
    codex: {
      enabled: boolean;
      models: string[];
    };
    kimi: {
      enabled: boolean;
    };
    kiro: {
      enabled: boolean;
    };
    kilo: {
      enabled: boolean;
      models: string[];
    };
    qwen: {
      enabled: boolean;
    };
    goose: {
      enabled: boolean;
    };
    gemini: {
      enabled: boolean;
    };
  };
  workspaces: {
    id: string;
    type: "slack" | "discord" | "lark";
    name: string;
    domain: string;
    status: "active" | "paused";
    channels: number;
    members: number;
    lastSync: string;
    slackAppToken?: string;
    slackBotToken?: string;
    discordBotToken?: string;
    larkAppKey?: string;
    larkAppId?: string;
    larkAppSecret?: string;
    channelDetails: {
      id: string;
      name: string;
      agentProvider?: AgentProviderId;
      model: string;
      workingDirectory: string;
      baseBranch: string;
      channelSystemMessage?: string;
    }[];
  }[];
};

const defaultWorkspace: DashboardConfig["workspaces"][number] = {
  id: "workspace-1",
  type: "slack",
  name: "Workspace 1",
  domain: "",
  status: "active",
  channels: 0,
  members: 0,
  lastSync: "",
  channelDetails: [],
};

export const defaultDashboardConfig: DashboardConfig = {
  completeOnboarding: false,
  user: {
    name: "",
    email: "",
    gitStrategy: "worktree",
    defaultStatusMessageFormat: "medium",
    statusMessageFrequencyMs: DEFAULT_STATUS_MESSAGE_FREQUENCY_MS,
  },
  updates: {
    autoUpgrade: true,
  },
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
  workspaces: [],
};

const cloneDefaultDashboardConfig = (): DashboardConfig => structuredClone(defaultDashboardConfig);

const asString = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;

const asBaseBranch = (value: unknown) => {
  const normalized = asString(value).trim();
  return normalized.length > 0 ? normalized : "main";
};

const asNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const asFrequency = (
  value: unknown
): DashboardConfig["user"]["defaultStatusMessageFormat"] => {
  if (value === "aggressive" || value === "minimum") return value;
  return "medium";
};

const asStatusMessageFrequencyMs = (value: unknown): StatusMessageFrequencyMs =>
  parseStatusMessageFrequencyMs(value);

const asGitStrategy = (
  value: unknown
): DashboardConfig["user"]["gitStrategy"] =>
  value === "default" ? "default" : "worktree";

const asStatus = (value: unknown): DashboardConfig["workspaces"][number]["status"] =>
  value === "paused" ? "paused" : "active";

function isKnownAgentProvider(
  value: string
): value is NonNullable<DashboardConfig["workspaces"][number]["channelDetails"][number]["agentProvider"]> {
  return isAgentProviderId(value);
}

const asAgentProvider = (
  value: unknown
): DashboardConfig["workspaces"][number]["channelDetails"][number]["agentProvider"] =>
  typeof value === "string" && isKnownAgentProvider(value)
    ? value
    : "opencode";

const sanitizeChannelDetail = (
  channel: unknown
): DashboardConfig["workspaces"][number]["channelDetails"][number] | null => {
  if (!channel || typeof channel !== "object") return null;
  const detail = channel as Record<string, unknown>;
  return {
    id: asString(detail.id),
    name: asString(detail.name),
    agentProvider: asAgentProvider(detail.agentProvider),
    model: asString(detail.model),
    workingDirectory: asString(detail.workingDirectory),
    baseBranch: asBaseBranch(detail.baseBranch),
    channelSystemMessage: asString(detail.channelSystemMessage),
  };
};

const sanitizeWorkspace = (
  workspaceInput: unknown,
  fallbackId: string,
  fallbackName: string
): DashboardConfig["workspaces"][number] => {
  if (!workspaceInput || typeof workspaceInput !== "object") {
    return {
      ...structuredClone(defaultWorkspace),
      id: fallbackId,
      name: fallbackName,
    };
  }

  const workspace = workspaceInput as Record<string, unknown>;
  const channelDetails = Array.isArray(workspace.channelDetails)
    ? (workspace.channelDetails
        .map((channel) => sanitizeChannelDetail(channel))
        .filter(Boolean) as DashboardConfig["workspaces"][number]["channelDetails"])
    : [];
  const slackAppToken = asString(workspace.slackAppToken, "");
  const slackBotToken = asString(workspace.slackBotToken, "");
  const discordBotToken = asString(workspace.discordBotToken, "");
  const larkAppKey = asString(workspace.larkAppKey, "") || asString(workspace.larkAppId, "");
  const larkAppSecret = asString(workspace.larkAppSecret, "");
  const type = workspace.type === "discord" ? "discord" : workspace.type === "lark" ? "lark" : "slack";

  return {
    id: asString(workspace.id) || fallbackId,
    type,
    name: asString(workspace.name) || fallbackName,
    domain: asString(workspace.domain),
    status: asStatus(workspace.status),
    channels: asNumber(workspace.channels),
    members: asNumber(workspace.members),
    lastSync: asString(workspace.lastSync),
    slackAppToken: slackAppToken || undefined,
    slackBotToken: slackBotToken || undefined,
    discordBotToken: discordBotToken || undefined,
    larkAppKey: larkAppKey || undefined,
    larkAppId: larkAppKey || undefined,
    larkAppSecret: larkAppSecret || undefined,
    channelDetails,
  };
};

const sanitizeWorkspaces = (workspaces: unknown): DashboardConfig["workspaces"] => {
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    return [];
  }

  return workspaces.map((workspace, index) =>
    sanitizeWorkspace(workspace, `workspace-${index + 1}`, `Workspace ${index + 1}`)
  );
};

export const sanitizeDashboardConfig = (config: unknown): DashboardConfig => {
  if (!config || typeof config !== "object") {
    return cloneDefaultDashboardConfig();
  }

  const record = config as Record<string, unknown>;
  const user = record.user && typeof record.user === "object" ? (record.user as Record<string, unknown>) : {};

  const agentsRecord = record.agents && typeof record.agents === "object"
    ? (record.agents as Record<string, unknown>)
    : {};
  const opencodeRecord = agentsRecord.opencode && typeof agentsRecord.opencode === "object"
    ? (agentsRecord.opencode as Record<string, unknown>)
    : {};
  const claudecodeRecord = agentsRecord.claudecode && typeof agentsRecord.claudecode === "object"
    ? (agentsRecord.claudecode as Record<string, unknown>)
    : {};
  const codexRecord = agentsRecord.codex && typeof agentsRecord.codex === "object"
    ? (agentsRecord.codex as Record<string, unknown>)
    : {};
  const kimiRecord = agentsRecord.kimi && typeof agentsRecord.kimi === "object"
    ? (agentsRecord.kimi as Record<string, unknown>)
    : {};
  const kiroRecord = agentsRecord.kiro && typeof agentsRecord.kiro === "object"
    ? (agentsRecord.kiro as Record<string, unknown>)
    : {};
  const kiloRecord = agentsRecord.kilo && typeof agentsRecord.kilo === "object"
    ? (agentsRecord.kilo as Record<string, unknown>)
    : {};
  const qwenRecord = agentsRecord.qwen && typeof agentsRecord.qwen === "object"
    ? (agentsRecord.qwen as Record<string, unknown>)
    : {};
  const gooseRecord = agentsRecord.goose && typeof agentsRecord.goose === "object"
    ? (agentsRecord.goose as Record<string, unknown>)
    : {};
  const geminiRecord = agentsRecord.gemini && typeof agentsRecord.gemini === "object"
    ? (agentsRecord.gemini as Record<string, unknown>)
    : {};

  const opencodeModels = asStringArray(opencodeRecord.models);
  const codexModels = asStringArray(codexRecord.models);

  const workspaces = sanitizeWorkspaces(record.workspaces);

  return {
    completeOnboarding: record.completeOnboarding === true,
    user: {
      name: asString(user.name),
      email: asString(user.email),
      initials: asString(user.initials, "") || undefined,
      avatar: asString(user.avatar, "") || undefined,
      gitStrategy: asGitStrategy(user.gitStrategy),
      defaultStatusMessageFormat: asFrequency(
        user.defaultStatusMessageFormat ?? user.defaultMessageFrequency
      ),
      statusMessageFrequencyMs: asStatusMessageFrequencyMs(user.statusMessageFrequencyMs),
    },
    updates: {
      autoUpgrade: record.updates && typeof record.updates === "object"
        ? (record.updates as Record<string, unknown>).autoUpgrade !== false
        : true,
    },
    agents: {
      opencode: {
        enabled: opencodeRecord.enabled !== false,
        models: Array.from(new Set(opencodeModels.filter(Boolean))),
      },
      claudecode: {
        enabled: claudecodeRecord.enabled !== false,
      },
      codex: {
        enabled: codexRecord.enabled !== false,
        models: Array.from(new Set(codexModels.filter(Boolean))),
      },
      kimi: {
        enabled: kimiRecord.enabled !== false,
      },
      kiro: {
        enabled: kiroRecord.enabled !== false,
      },
      kilo: {
        enabled: kiloRecord.enabled !== false,
        models: Array.from(new Set(asStringArray(kiloRecord.models).filter(Boolean))),
      },
      qwen: {
        enabled: qwenRecord.enabled !== false,
      },
      goose: {
        enabled: gooseRecord.enabled !== false,
      },
      gemini: {
        enabled: geminiRecord.enabled !== false,
      },
    },
    workspaces,
  };
};
