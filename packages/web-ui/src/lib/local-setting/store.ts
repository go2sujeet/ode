import { get, writable } from "svelte/store";
import { defaultDashboardConfig, type DashboardConfig } from "../localConfig";

export type CliCheckResult = {
  opencode: boolean;
  claude: boolean;
  codex: boolean;
  opencodeModels?: string[];
  opencodeModelError?: string;
};

type LocalSettingState = {
  config: DashboardConfig;
  isLoading: boolean;
  isSaving: boolean;
  isSyncingSlack: boolean;
  isCheckingCli: boolean;
  loaded: boolean;
  message: string;
  agentMessage: string;
  cliCheckResult: CliCheckResult | null;
};

const initialState: LocalSettingState = {
  config: defaultDashboardConfig,
  isLoading: false,
  isSaving: false,
  isSyncingSlack: false,
  isCheckingCli: false,
  loaded: false,
  message: "",
  agentMessage: "",
  cliCheckResult: null,
};

const store = writable<LocalSettingState>(initialState);

function normalizeConfig(input: DashboardConfig): DashboardConfig {
  return {
    ...input,
    user: {
      ...input.user,
      gitStrategy: input.user.gitStrategy ?? "worktree",
      defaultMessageFrequency: input.user.defaultMessageFrequency ?? "medium",
    },
    agents: {
      opencode: {
        enabled: input.agents?.opencode?.enabled ?? true,
        models: input.agents?.opencode?.models ?? [],
      },
      claudecode: {
        enabled: input.agents?.claudecode?.enabled ?? true,
      },
      codex: {
        enabled: input.agents?.codex?.enabled ?? true,
      },
    },
  };
}

function updateConfig(updater: (config: DashboardConfig) => DashboardConfig): void {
  store.update((state) => ({
    ...state,
    config: updater(state.config),
  }));
}

function updateWorkspace(
  workspaceId: string,
  updater: (workspace: DashboardConfig["workspaces"][number]) => DashboardConfig["workspaces"][number]
): void {
  updateConfig((config) => ({
    ...config,
    workspaces: config.workspaces.map((workspace) => (workspace.id === workspaceId ? updater(workspace) : workspace)),
  }));
}

async function loadConfig(): Promise<void> {
  const current = get(store);
  if (current.isLoading) return;

  store.update((state) => ({ ...state, isLoading: true, message: "" }));
  try {
    const response = await fetch("/api/config");
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      config?: DashboardConfig;
    };
    if (!response.ok || !payload.ok || !payload.config) {
      throw new Error(payload.error || "Failed to load config");
    }
    store.update((state) => ({
      ...state,
      config: normalizeConfig(payload.config as DashboardConfig),
      loaded: true,
      isLoading: false,
    }));
  } catch (error) {
    store.update((state) => ({
      ...state,
      loaded: true,
      isLoading: false,
      message: `Load failed: ${error instanceof Error ? error.message : String(error)}`,
    }));
  }
}

async function saveConfig(): Promise<void> {
  store.update((state) => ({ ...state, isSaving: true, message: "" }));
  try {
    const payload = get(store).config;
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      config?: DashboardConfig;
    };
    if (!response.ok || !result.ok || !result.config) {
      throw new Error(result.error || "Failed to save config");
    }
    store.update((state) => ({
      ...state,
      config: normalizeConfig(result.config as DashboardConfig),
      isSaving: false,
      message: "Saved.",
    }));
  } catch (error) {
    store.update((state) => ({
      ...state,
      isSaving: false,
      message: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
    }));
  }
}

async function checkAgents(): Promise<void> {
  store.update((state) => ({ ...state, isCheckingCli: true, agentMessage: "" }));
  try {
    const response = await fetch("/api/agent-check");
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      result?: CliCheckResult;
    };
    if (!response.ok || !payload.ok || !payload.result) {
      throw new Error(payload.error || "Failed to check local CLIs");
    }
    const result = payload.result;
    const fetchedModels = Array.isArray(result.opencodeModels) ? result.opencodeModels : null;
    store.update((state) => ({
      ...state,
      cliCheckResult: result,
      isCheckingCli: false,
      config: {
        ...state.config,
        agents: {
          ...state.config.agents,
          opencode: {
            ...state.config.agents.opencode,
            enabled: result.opencode,
            models: fetchedModels ?? state.config.agents.opencode.models,
          },
          claudecode: {
            ...state.config.agents.claudecode,
            enabled: result.claude,
          },
          codex: {
            ...state.config.agents.codex,
            enabled: result.codex,
          },
        },
      },
      agentMessage: result.opencode && result.opencodeModelError
        ? `Checked local agent CLIs. OpenCode model fetch failed: ${result.opencodeModelError}`
        : fetchedModels
          ? `Checked local agent CLIs. Synced ${fetchedModels.length} OpenCode models.`
          : "Checked local agent CLIs.",
    }));
  } catch (error) {
    store.update((state) => ({
      ...state,
      isCheckingCli: false,
      agentMessage: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
    }));
  }
}

async function syncSlackWorkspace(workspaceId: string): Promise<void> {
  store.update((state) => ({ ...state, isSyncingSlack: true, message: "" }));
  try {
    const response = await fetch("/api/slack-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      workspace?: DashboardConfig["workspaces"][number];
    };
    if (!response.ok || !payload.ok || !payload.workspace) {
      throw new Error(payload.error || "Slack sync failed");
    }
    store.update((state) => ({
      ...state,
      isSyncingSlack: false,
      config: {
        ...state.config,
        workspaces: state.config.workspaces.map((workspace) =>
          workspace.id === payload.workspace!.id ? payload.workspace! : workspace
        ),
      },
      message: "Slack workspace synced.",
    }));
  } catch (error) {
    store.update((state) => ({
      ...state,
      isSyncingSlack: false,
      message: `Slack sync failed: ${error instanceof Error ? error.message : String(error)}`,
    }));
  }
}

export const localSettingStore = {
  subscribe: store.subscribe,
  loadConfig,
  saveConfig,
  checkAgents,
  syncSlackWorkspace,
  updateConfig,
  updateWorkspace,
};
