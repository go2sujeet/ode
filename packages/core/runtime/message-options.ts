import { getChannelModel } from "@/config";
import type { OpenCodeOptions } from "@/agents";
import {
  providerSupportsModelSelection,
  type AgentProviderId,
} from "@/shared/agent-provider";

function defaultModelProvider(providerId: AgentProviderId): string {
  if (providerId === "codex") return "openai";
  if (providerId === "kilo") return "kilo";
  if (providerId === "pi") return "anthropic";
  if (providerId === "openhands") return "anthropic";
  if (providerId === "codebuddy") return "codebuddy";
  if (providerId === "crush") return "chainbot";
  return providerId;
}

function toSelectedModel(
  providerId: AgentProviderId,
  modelValue: string | null | undefined
): OpenCodeOptions["model"] | undefined {
  const trimmed = modelValue?.trim();
  if (!trimmed) return undefined;
  const [providerID = defaultModelProvider(providerId), ...rest] = trimmed.split("/");
  if (rest.length === 0) {
    return { providerID: defaultModelProvider(providerId), modelID: trimmed };
  }
  return { providerID, modelID: rest.join("/") };
}

export function buildMessageOptions(params: {
  text: string;
  channelId: string;
  providerId: AgentProviderId;
}): OpenCodeOptions | undefined {
  const { text, channelId, providerId } = params;
  const normalizedText = text.trimStart().toLowerCase();
  const agent = /^plan\b/.test(normalizedText) ? "plan" : undefined;

  const channelModel = getChannelModel(channelId)?.trim();
  const selectedModel = providerSupportsModelSelection(providerId)
    ? toSelectedModel(providerId, channelModel)
    : undefined;

  if (!agent && !selectedModel) {
    return undefined;
  }

  return {
    ...(agent ? { agent } : {}),
    ...(selectedModel ? { model: selectedModel } : {}),
  };
}
