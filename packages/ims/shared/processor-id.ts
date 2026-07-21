import { createHash } from "node:crypto";

export function createProcessorId(platform: "slack" | "discord" | "lark" | "github", credential: string): string {
  const normalized = credential.trim();
  if (!normalized) return `${platform}:default`;
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `${platform}:${digest}`;
}
