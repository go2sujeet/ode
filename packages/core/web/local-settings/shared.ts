import type { DashboardConfig } from "@/config";
import { normalizeAgentProviderId } from "@/shared/agent-provider";

export type WorkspaceConfig = DashboardConfig["workspaces"][number];
export type ChannelDetail = WorkspaceConfig["channelDetails"][number];

type ChannelAgentProvider = ChannelDetail["agentProvider"];

export function normalizeChannelAgentProvider(value: unknown): NonNullable<ChannelAgentProvider> {
  return normalizeAgentProviderId(value);
}

export function resolveFallbackModel(
  agentProvider: NonNullable<ChannelAgentProvider>,
  fallbackModel: string
): string {
  return agentProvider === "opencode" || agentProvider === "codex"
    ? fallbackModel
    : "";
}
