import { startServer as startCodexServer } from "@/agents/codex";
import {
  getCodexModels,
  getEnabledAgentProviders,
  getKiloModels,
  getOpenCodeModels,
  invalidateOdeConfigCache,
} from "@/config";
import { runAgentCheck, type AgentCheckResult } from "@/core/web/agent-check";
import { AGENT_PROVIDERS, type AgentProviderId } from "@/shared/agent-provider";

export type SettingsProviderData = {
  enabledProviders: AgentProviderId[];
  opencodeModels: string[];
  codexModels: string[];
  kiloModels: string[];
};

function getSelectableProvidersFromConfig(): AgentProviderId[] {
  const enabled = getEnabledAgentProviders().filter(
    (provider): provider is AgentProviderId => AGENT_PROVIDERS.includes(provider as AgentProviderId)
  );
  if (enabled.length > 0) return enabled;
  return Array.from(AGENT_PROVIDERS);
}

function getSelectableProvidersFromAgentCheck(
  result: AgentCheckResult,
  selectedProvider?: AgentProviderId
): AgentProviderId[] {
  const enabled = AGENT_PROVIDERS.filter((provider) => {
    if (provider === "claudecode") return result.claudecode;
    return result[provider];
  });

  if (selectedProvider && !enabled.includes(selectedProvider)) {
    enabled.unshift(selectedProvider);
  }

  if (enabled.length > 0) return enabled;
  return getSelectableProvidersFromConfig();
}

export async function refreshSettingsProviderData(selectedProvider?: AgentProviderId): Promise<SettingsProviderData> {
  invalidateOdeConfigCache();

  let agentCheckResult: AgentCheckResult | null = null;
  try {
    agentCheckResult = await runAgentCheck();
  } catch {
    // Fall back to the config currently loaded from disk.
  }

  try {
    await startCodexServer();
  } catch {
    // Fall back to models currently stored in local config.
  }

  return {
    enabledProviders: agentCheckResult
      ? getSelectableProvidersFromAgentCheck(agentCheckResult, selectedProvider)
      : getSelectableProvidersFromConfig(),
    opencodeModels: agentCheckResult ? agentCheckResult.opencodeModels : getOpenCodeModels(),
    codexModels: getCodexModels(),
    kiloModels: agentCheckResult ? agentCheckResult.kiloModels : getKiloModels(),
  };
}
