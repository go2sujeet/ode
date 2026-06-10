import { createHash } from "node:crypto";
import type { DashboardConfig } from "@/config";
import {
  normalizeAgentProviderId,
  providerSupportsModelSelection,
} from "@/shared/agent-provider";

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
  return providerSupportsModelSelection(agentProvider)
    ? fallbackModel
    : "";
}

export function createWorkspaceCredentialId(
  platform: "slack" | "discord" | "lark",
  credential: string
): string {
  const normalized = credential.trim();
  const digest = createHash("sha256").update(normalized).digest("hex");
  return `${platform}-${digest}`;
}
