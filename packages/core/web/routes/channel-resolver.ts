import { loadOdeConfig } from "@/config/local/ode-store";

// Shared channel resolution helper used by the Ode CLI-facing routes
// (`/api/send/file`, `/api/messages/thread`, `/api/reactions`) to translate
// a user-supplied channel locator into a concrete `(platform, workspaceId,
// channelId)` tuple backed by the persisted Ode config.

export type ResolvedChannelPlatform = "slack" | "discord" | "lark";

export type ResolvedChannel = {
  platform: ResolvedChannelPlatform;
  workspaceId: string;
  workspaceName: string;
  channelId: string;
};

/**
 * Resolve a channel locator to a concrete workspace + channel. Accepts either
 * a raw channel id (e.g. `C123`) or a `"workspaceId::channelId"` pair for
 * ambiguity resolution — the same convention `ode task` / `ode cron` use.
 */
export function resolveChannelLocator(input: string): ResolvedChannel {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("channelId is required");
  }

  const delimiterIndex = trimmed.lastIndexOf("::");
  const workspaceHint = delimiterIndex >= 0 ? trimmed.slice(0, delimiterIndex) : "";
  const rawChannelId = delimiterIndex >= 0 ? trimmed.slice(delimiterIndex + 2).trim() : trimmed;
  if (!rawChannelId) {
    throw new Error("channelId is required");
  }

  const config = loadOdeConfig();
  for (const workspace of config.workspaces) {
    if (workspaceHint && workspace.id !== workspaceHint) continue;
    const channel = workspace.channelDetails.find((entry) => entry.id === rawChannelId);
    if (channel) {
      return {
        platform: workspace.type,
        workspaceId: workspace.id,
        workspaceName: workspace.name || workspace.id,
        channelId: channel.id,
      };
    }
  }
  throw new Error("Channel not found in configured workspaces");
}
