import { existsSync } from "fs";
import {
  getChannelAgentProvider,
  getChannelModel,
  getCodexModels,
  getEnabledAgentProviders,
  getKiloModels,
  getPiModels,
  getOpenHandsModels,
  getCodeBuddyModels,
  getCrushModels,
  getOpenCodeModels,
  isAgentEnabled,
  resolveChannelCwd,
} from "@/config";
import {
  AGENT_PROVIDERS,
  getAgentProviderLabel,
  providerSupportsModelSelection,
  type AgentProviderId,
} from "@/shared/agent-provider";
import { getProviderModelList, type ProviderModelLists } from "@/shared/channel-settings";

export type SettingsLauncherAction = "general" | "channel" | "github";

export const SETTINGS_LAUNCHER_ITEMS: Array<{ action: SettingsLauncherAction; label: string }> = [
  { action: "general", label: "General setting" },
  { action: "channel", label: "Channel setting" },
  { action: "github", label: "GitHub info" },
];

export function getProviderModelListsFromConfig(): ProviderModelLists {
  return {
    opencode: getOpenCodeModels(),
    codex: getCodexModels(),
    kilo: getKiloModels(),
    pi: getPiModels(),
    openhands: getOpenHandsModels(),
    codebuddy: getCodeBuddyModels(),
    crush: getCrushModels(),
  };
}

export function getEnabledProvidersWithFallback(): AgentProviderId[] {
  const enabled = getEnabledAgentProviders();
  return enabled.length > 0 ? enabled : Array.from(AGENT_PROVIDERS);
}

export function describeChannelSettingsIssues(channelId: string): string[] {
  const issues: string[] = [];
  const provider = getChannelAgentProvider(channelId);
  const model = getChannelModel(channelId);
  const { workingDirectory } = resolveChannelCwd(channelId);
  const normalizeModel = (value: string) => value.trim().toLowerCase();

  if (!isAgentEnabled(provider)) {
    issues.push(`Agent not enabled: ${provider}`);
  }

  if (providerSupportsModelSelection(provider)) {
    const lists = getProviderModelListsFromConfig();
    const models = getProviderModelList(provider, lists);
    const modelSet = new Set(models.map(normalizeModel));
    if (!model && provider !== "codex") {
      issues.push("Model not configured.");
    } else if (model && !modelSet.has(normalizeModel(model))) {
      issues.push(`Model not available in configured ${getAgentProviderLabel(provider)} models.`);
    }
  }

  if (!workingDirectory) {
    issues.push("Working directory not configured.");
  } else if (!existsSync(workingDirectory)) {
    issues.push(`Working directory not found: ${workingDirectory}`);
  }

  return issues;
}
