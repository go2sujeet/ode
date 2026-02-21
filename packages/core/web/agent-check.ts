import { getAnyServerUrl, startServer as startOpenCodeServer } from "@/agents/opencode";

export type AgentInstallStatus = {
  opencode: boolean;
  claudecode: boolean;
  codex: boolean;
  kimi: boolean;
  kiro: boolean;
  kilo: boolean;
  qwen: boolean;
  goose: boolean;
  gemini: boolean;
};

export type AgentCheckResult = AgentInstallStatus & {
  claude: boolean;
  opencodeModels: string[];
  opencodeModelError?: string;
  kiloModels: string[];
  kiloModelError?: string;
};

function extractProviderModelIds(providerId: string, models: unknown): string[] {
  if (Array.isArray(models)) {
    return models
      .map((entry) => {
        if (typeof entry === "string") return `${providerId}/${entry}`;
        if (!entry || typeof entry !== "object") return "";
        const model = entry as Record<string, unknown>;
        const modelId =
          (typeof model.id === "string" && model.id)
          || (typeof model.modelID === "string" && model.modelID)
          || (typeof model.modelId === "string" && model.modelId)
          || "";
        return modelId ? `${providerId}/${modelId}` : "";
      })
      .filter(Boolean);
  }

  if (models && typeof models === "object") {
    const record = models as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return extractProviderModelIds(providerId, record.items);
    }
    return Object.entries(record)
      .map(([key, value]) => {
        if (typeof value === "string") return `${providerId}/${value}`;
        if (value && typeof value === "object") {
          const model = value as Record<string, unknown>;
          const modelId =
            (typeof model.id === "string" && model.id)
            || (typeof model.modelID === "string" && model.modelID)
            || (typeof model.modelId === "string" && model.modelId)
            || key;
          return modelId ? `${providerId}/${modelId}` : "";
        }
        return key ? `${providerId}/${key}` : "";
      })
      .filter(Boolean);
  }

  return [];
}

function extractOpenCodeModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const providersRaw = Object.prototype.hasOwnProperty.call(data, "providers") ? data.providers : data;
  const models = new Set<string>();

  if (Array.isArray(providersRaw)) {
    for (const entry of providersRaw) {
      if (!entry || typeof entry !== "object") continue;
      const provider = entry as Record<string, unknown>;
      const providerId =
        (typeof provider.id === "string" && provider.id)
        || (typeof provider.providerID === "string" && provider.providerID)
        || (typeof provider.providerId === "string" && provider.providerId)
        || "";
      if (!providerId) continue;
      for (const model of extractProviderModelIds(providerId, provider.models)) {
        models.add(model);
      }
    }
  } else if (providersRaw && typeof providersRaw === "object") {
    for (const [providerId, providerValue] of Object.entries(providersRaw as Record<string, unknown>)) {
      if (!providerValue || typeof providerValue !== "object") continue;
      const provider = providerValue as Record<string, unknown>;
      for (const model of extractProviderModelIds(providerId, provider.models)) {
        models.add(model);
      }
    }
  }

  return Array.from(models).sort();
}

async function fetchKiloModels(): Promise<string[]> {
  const child = Bun.spawn({
    cmd: ["kilo", "models"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    const details = stderr.trim() || stdout.trim() || "Unknown error";
    throw new Error(details);
  }
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

export function getInstalledAgentStatus(): AgentInstallStatus {
  return {
    opencode: Boolean(Bun.which("opencode")),
    claudecode: Boolean(Bun.which("claude")),
    codex: Boolean(Bun.which("codex")),
    kimi: Boolean(Bun.which("kimi")),
    kiro: Boolean(Bun.which("kiro-cli") || Bun.which("kiro")),
    kilo: Boolean(Bun.which("kilo")),
    qwen: Boolean(Bun.which("qwen") || Bun.which("qwen-code")),
    goose: Boolean(Bun.which("goose")),
    gemini: Boolean(Bun.which("gemini")),
  };
}

export async function runAgentCheck(): Promise<AgentCheckResult> {
  const installed = getInstalledAgentStatus();
  let opencodeModels: string[] = [];
  let opencodeModelError: string | undefined;
  let kiloModels: string[] = [];
  let kiloModelError: string | undefined;

  if (installed.opencode) {
    try {
      await startOpenCodeServer();
      const baseUrl = await getAnyServerUrl();
      const providersUrl = new URL("/config/providers", baseUrl).toString();
      const response = await fetch(providersUrl);
      if (!response.ok) {
        throw new Error(`providers endpoint returned ${response.status}`);
      }
      const payload = await response.json();
      opencodeModels = extractOpenCodeModels(payload);
    } catch (error) {
      opencodeModelError = error instanceof Error ? error.message : String(error);
    }
  }

  if (installed.kilo) {
    try {
      kiloModels = await fetchKiloModels();
    } catch (error) {
      kiloModelError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ...installed,
    claude: installed.claudecode,
    opencodeModels,
    opencodeModelError,
    kiloModels,
    kiloModelError,
  };
}
