import { getChannelModel } from "@/config";
import type { OpenCodeOptions } from "@/agents";

type ProviderId = "opencode" | "claudecode" | "codex" | "kimi" | "kiro" | "kilo" | "qwen" | "goose" | "gemini";

function toKiloModel(modelValue: string | null | undefined): OpenCodeOptions["model"] | undefined {
  const trimmed = modelValue?.trim();
  if (!trimmed) return undefined;
  const [providerID = "kilo", ...rest] = trimmed.split("/");
  if (rest.length === 0) {
    return { providerID: "kilo", modelID: trimmed };
  }
  return { providerID, modelID: rest.join("/") };
}

export function buildMessageOptions(params: {
  text: string;
  channelId: string;
  providerId: ProviderId;
}): OpenCodeOptions | undefined {
  const { text, channelId, providerId } = params;
  const normalizedText = text.trimStart().toLowerCase();
  const agent = /^plan\b/.test(normalizedText) ? "plan" : undefined;

  const channelModel = getChannelModel(channelId)?.trim();
  const codexModel = providerId === "codex"
    ? (channelModel && channelModel.length > 0 ? channelModel : undefined)
    : undefined;
  const kiloModel = providerId === "kilo" ? toKiloModel(channelModel) : undefined;

  if (!agent && !codexModel && !kiloModel) {
    return undefined;
  }

  return {
    ...(agent ? { agent } : {}),
    ...(codexModel ? { model: { providerID: "openai", modelID: codexModel } } : {}),
    ...(kiloModel ? { model: kiloModel } : {}),
  };
}
