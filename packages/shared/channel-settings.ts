import {
  providerSupportsModelSelection,
  type AgentProviderId,
} from "@/shared/agent-provider";

export const MODEL_NONE_SENTINEL = "__none__";
export const MODEL_DEFAULT_SENTINEL = "__default__";

export type ProviderModelLists = {
  opencode: string[];
  codex: string[];
  kilo: string[];
  pi: string[];
  openhands: string[];
  codebuddy: string[];
  crush: string[];
};

function normalizeModel(value: string): string {
  return value.trim().toLowerCase();
}

export function findMatchingModel(
  models: string[],
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const target = normalizeModel(value);
  return models.find((model) => normalizeModel(model) === target) ?? null;
}

export function getProviderModelList(
  provider: AgentProviderId,
  lists: ProviderModelLists
): string[] {
  if (provider in lists) return lists[provider as keyof ProviderModelLists];
  return [];
}

export function validateProviderModelSelection(params: {
  provider: AgentProviderId;
  selectedModel: string | null | undefined;
  lists: ProviderModelLists;
}): boolean {
  const { provider, selectedModel, lists } = params;
  if (!providerSupportsModelSelection(provider)) return true;

  if (provider === "codex") {
    if (!selectedModel || selectedModel === MODEL_DEFAULT_SENTINEL) return true;
    return findMatchingModel(lists.codex, selectedModel) !== null;
  }

  if (!selectedModel || selectedModel === MODEL_NONE_SENTINEL) {
    return false;
  }

  return findMatchingModel(getProviderModelList(provider, lists), selectedModel) !== null;
}

export function resolveStoredModelForProvider(params: {
  provider: AgentProviderId;
  selectedModel: string | null | undefined;
  lists: ProviderModelLists;
}): string {
  const { provider, selectedModel, lists } = params;
  if (!providerSupportsModelSelection(provider)) return "";

  if (provider === "codex") {
    if (!selectedModel || selectedModel === MODEL_DEFAULT_SENTINEL) return "";
    return findMatchingModel(lists.codex, selectedModel) ?? selectedModel;
  }

  if (!selectedModel || selectedModel === MODEL_NONE_SENTINEL) return "";
  return findMatchingModel(getProviderModelList(provider, lists), selectedModel) ?? selectedModel;
}
