export const AGENT_PROVIDERS = [
  "opencode",
  "claudecode",
  "codex",
  "kimi",
  "kiro",
  "kilo",
  "qwen",
  "goose",
  "gemini",
] as const;

export type AgentProviderId = (typeof AGENT_PROVIDERS)[number];

const AGENT_PROVIDER_SET = new Set<string>(AGENT_PROVIDERS);

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return typeof value === "string" && AGENT_PROVIDER_SET.has(value);
}

export function normalizeAgentProviderId(
  value: unknown,
  fallback: AgentProviderId = "opencode"
): AgentProviderId {
  return isAgentProviderId(value) ? value : fallback;
}

export function providerSupportsModelSelection(provider: AgentProviderId): boolean {
  return provider === "opencode" || provider === "codex" || provider === "kilo";
}
