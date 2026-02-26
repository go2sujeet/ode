import { createHash } from "node:crypto";

const SCOPE_DELIMITER = "::";

export function createProcessorId(platform: "slack" | "discord" | "lark", credential: string): string {
  const normalized = credential.trim();
  if (!normalized) return `${platform}:default`;
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `${platform}:${digest}`;
}

export function scopeChannelId(processorId: string, channelId: string): string {
  if (!processorId || !channelId) return channelId;
  return `${processorId}${SCOPE_DELIMITER}${channelId}`;
}

export function parseScopedChannelId(channelId: string): { processorId: string; channelId: string } | null {
  const splitAt = channelId.indexOf(SCOPE_DELIMITER);
  if (splitAt <= 0) return null;
  const processorId = channelId.slice(0, splitAt);
  const rawChannelId = channelId.slice(splitAt + SCOPE_DELIMITER.length);
  if (!processorId || !rawChannelId) return null;
  return { processorId, channelId: rawChannelId };
}

export function unscopeChannelId(channelId: string): string {
  return parseScopedChannelId(channelId)?.channelId ?? channelId;
}

export function getScopedProcessorId(channelId: string): string | undefined {
  return parseScopedChannelId(channelId)?.processorId;
}
