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

type AgentProviderMetadata = {
  aliases: readonly string[];
  supportsEventStream: boolean;
  supportsModelSelection: boolean;
};

export const AGENT_PROVIDER_MANIFEST: Record<AgentProviderId, AgentProviderMetadata> = {
  opencode: {
    aliases: [],
    supportsEventStream: true,
    supportsModelSelection: true,
  },
  claudecode: {
    aliases: ["claude"],
    supportsEventStream: false,
    supportsModelSelection: false,
  },
  codex: {
    aliases: [],
    supportsEventStream: false,
    supportsModelSelection: true,
  },
  kimi: {
    aliases: [],
    supportsEventStream: false,
    supportsModelSelection: false,
  },
  kiro: {
    aliases: [],
    supportsEventStream: false,
    supportsModelSelection: false,
  },
  kilo: {
    aliases: [],
    supportsEventStream: false,
    supportsModelSelection: true,
  },
  qwen: {
    aliases: [],
    supportsEventStream: false,
    supportsModelSelection: false,
  },
  goose: {
    aliases: [],
    supportsEventStream: false,
    supportsModelSelection: false,
  },
  gemini: {
    aliases: [],
    supportsEventStream: false,
    supportsModelSelection: false,
  },
};

const AGENT_PROVIDER_SET = new Set<string>(AGENT_PROVIDERS);
const AGENT_PROVIDER_ALIAS_MAP = new Map<string, AgentProviderId>(
  AGENT_PROVIDERS.flatMap((provider) =>
    AGENT_PROVIDER_MANIFEST[provider].aliases.map((alias) => [alias, provider] as const)
  )
);

export function isAgentProviderId(value: unknown): value is AgentProviderId {
  return typeof value === "string" && AGENT_PROVIDER_SET.has(value);
}

export function normalizeAgentProviderId(
  value: unknown,
  fallback: AgentProviderId = "opencode"
): AgentProviderId {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (isAgentProviderId(normalized)) return normalized;
  return AGENT_PROVIDER_ALIAS_MAP.get(normalized) ?? fallback;
}

export function providerSupportsModelSelection(provider: AgentProviderId): boolean {
  return AGENT_PROVIDER_MANIFEST[provider].supportsModelSelection;
}

export function providerSupportsEventStream(provider: AgentProviderId): boolean {
  return AGENT_PROVIDER_MANIFEST[provider].supportsEventStream;
}
