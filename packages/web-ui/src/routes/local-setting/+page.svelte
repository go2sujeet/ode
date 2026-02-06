<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import {
    defaultDashboardConfig,
    TOOL_DISPLAY_CONFIG,
    type DashboardConfig,
    type GitStrategy,
    type MessageFrequency,
  } from "$lib/localConfig";

  type AgentProvider = "opencode" | "claudecode";

  type CliCheckResult = {
    opencode: boolean;
    claude: boolean;
  };

  export let data: { config: DashboardConfig } | undefined;
  export let initialSection: "profile" | "agent" | "slack" = "profile";
  export let initialSlug: string | null = null;

  let config: DashboardConfig = data?.config ?? defaultDashboardConfig;
  let opencodeModelsText = "";
  let isLoading = false;
  let isSaving = false;
  let isSyncingSlack = false;
  let isCheckingCli = false;
  let message = "";
  let cliCheckResult: CliCheckResult | null = null;
  let pathname =
    initialSection === "agent"
      ? "/local-setting/agent"
      : initialSection === "slack"
        ? `/local-setting/slack-bot/${initialSlug ?? ""}`
        : "/local-setting/profile";
  let activeSection: "profile" | "agent" | "slack" = "profile";
  let enabledProviders: AgentProvider[] = ["opencode", "claudecode"];
  let selectedWorkspace: DashboardConfig["workspaces"][number] | null = null;

  const providerLabels: Record<AgentProvider, string> = {
    opencode: "OpenCode",
    claudecode: "Claude Code",
  };
  const messageFrequencyOptions = Object.keys(TOOL_DISPLAY_CONFIG) as MessageFrequency[];
  const gitStrategyOptions: GitStrategy[] = ["worktree", "default"];
  const gitStrategyLabels: Record<GitStrategy, string> = {
    worktree: "Worktree",
    default: "Default",
  };

  $: pathname = $page.url.pathname;
  $: activeSection =
    pathname.startsWith("/local-setting/agent")
      ? "agent"
      : pathname.startsWith("/local-setting/slack-bot")
        ? "slack"
        : "profile";
  $: enabledProviders = (Object.keys(providerLabels) as AgentProvider[]).filter((provider) => {
    if (provider === "opencode") return config.agents.opencode.enabled;
    return config.agents.claudecode.enabled;
  });
  $: selectedWorkspace = getSelectedWorkspace(pathname);
  $: opencodeModelsText = config.agents.opencode.models.join("\n");

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function getWorkspacePath(workspace: DashboardConfig["workspaces"][number]): string {
    return `/local-setting/slack-bot/${slugify(workspace.name) || workspace.id}`;
  }

  function getSelectedWorkspace(currentPathname: string): DashboardConfig["workspaces"][number] | null {
    if (!config.workspaces.length) return null;
    if (!currentPathname.startsWith("/local-setting/slack-bot")) return config.workspaces[0] ?? null;
    const [withoutQuery] = currentPathname.split("?");
    const segments = withoutQuery.split("/").filter(Boolean);
    const slug = decodeURIComponent(segments[2] ?? "");
    if (!slug) return config.workspaces[0] ?? null;
    return (
      config.workspaces.find((workspace) => slugify(workspace.name) === slug || workspace.id === slug) ??
      config.workspaces[0] ??
      null
    );
  }

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

  function normalizeModels(raw: string): string[] {
    return Array.from(
      new Set(
        raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      )
    );
  }

  function ensureAgentEnabled(provider: AgentProvider): AgentProvider {
    if (enabledProviders.includes(provider)) return provider;
    return enabledProviders[0] ?? "opencode";
  }

  function getChannelProvider(channel: { agentProvider?: string }): AgentProvider {
    if (channel.agentProvider === "claudecode") return "claudecode";
    return "opencode";
  }

  function shouldShowChannelModel(channel: { agentProvider?: string }): boolean {
    return getChannelProvider(channel) === "opencode";
  }

  function setChannelProvider(workspaceId: string, channelId: string, provider: AgentProvider): void {
    config = {
      ...config,
      workspaces: config.workspaces.map((workspace) => {
        if (workspace.id !== workspaceId) return workspace;
        return {
          ...workspace,
          channelDetails: workspace.channelDetails.map((channel) => {
            if (channel.id !== channelId) return channel;
            return {
              ...channel,
              agentProvider: provider,
              model: provider === "opencode" ? channel.model : "",
            };
          }),
        };
      }),
    };
  }

  function onChannelProviderChange(workspaceId: string, channelId: string, event: Event): void {
    const provider = (event.currentTarget as HTMLSelectElement).value === "claudecode" ? "claudecode" : "opencode";
    setChannelProvider(workspaceId, channelId, provider);
  }

  async function loadConfig(): Promise<void> {
    isLoading = true;
    message = "";
    try {
      const response = await fetch("/api/config");
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        config?: DashboardConfig;
      };
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to load config");
      }
      config = normalizeConfig(payload.config as DashboardConfig);
    } catch (error) {
      message = `Load failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isLoading = false;
    }
  }

  async function saveConfig(): Promise<void> {
    isSaving = true;
    message = "";
    const payload: DashboardConfig = {
      ...config,
      agents: {
        ...config.agents,
        opencode: {
          ...config.agents.opencode,
          models: normalizeModels(opencodeModelsText),
        },
      },
    };
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "Failed to save config");
      }
      config = normalizeConfig(result.config as DashboardConfig);
      message = "Saved.";
    } catch (error) {
      message = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isSaving = false;
    }
  }

  async function checkAgents(): Promise<void> {
    isCheckingCli = true;
    message = "";
    try {
      const response = await fetch("/api/agent-check");
      const payload = await response.json();
      if (!response.ok || !payload?.ok || !payload?.result) {
        throw new Error(payload?.error || "Failed to check local CLIs");
      }
      const result = payload.result as CliCheckResult;
      cliCheckResult = result;
      config = {
        ...config,
        agents: {
          ...config.agents,
          opencode: {
            ...config.agents.opencode,
            enabled: result.opencode,
          },
          claudecode: {
            ...config.agents.claudecode,
            enabled: result.claude,
          },
        },
      };
      message = "Checked local agent CLIs.";
    } catch (error) {
      message = `Check failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isCheckingCli = false;
    }
  }

  async function syncSlackWorkspace(workspaceId: string): Promise<void> {
    isSyncingSlack = true;
    message = "";
    try {
      const response = await fetch("/api/slack-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok || !payload.workspace) {
        throw new Error(payload?.error || "Slack sync failed");
      }
      config = {
        ...config,
        workspaces: config.workspaces.map((workspace) =>
          workspace.id === payload.workspace!.id ? payload.workspace! : workspace
        ),
      };
      message = "Slack workspace synced.";
    } catch (error) {
      message = `Slack sync failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isSyncingSlack = false;
    }
  }

  onMount(() => {
    if (!data?.config) {
      void loadConfig();
      return;
    }
    config = normalizeConfig(data.config);
  });
</script>

<main>
  <div class="container">
    <nav class="navbar">
      <div class="navbar-spacer"></div>
      <div class="navbar-title">Ode Setting</div>
      <div class="navbar-actions">
        <ThemeToggle />
      </div>
    </nav>

    <div class="layout">
    <aside class="sidebar card">
      <button class="nav-item {activeSection === 'profile' ? 'active' : ''}" on:click={() => goto('/local-setting/profile')}>
        Profile
      </button>
      <button class="nav-item {activeSection === 'agent' ? 'active' : ''}" on:click={() => goto('/local-setting/agent')}>
        Agent
      </button>
      <div class="workspace-group">
        <p>Slack Workspaces</p>
        {#if config.workspaces.length === 0}
          <span class="empty-tip">No workspaces</span>
        {:else}
          {#each config.workspaces as workspace}
            <button
              class="nav-item {selectedWorkspace?.id === workspace.id && activeSection === 'slack' ? 'active' : ''}"
              on:click={() => goto(getWorkspacePath(workspace))}
            >
              {workspace.name || workspace.id}
            </button>
          {/each}
        {/if}
      </div>
    </aside>

    <section class="content">
      {#if activeSection === "profile"}
        <section class="card">
          <h2>Profile</h2>
          <label for="profile-name">Name</label>
          <input id="profile-name" bind:value={config.user.name} />
          <label for="profile-email">Email</label>
          <input id="profile-email" bind:value={config.user.email} />

          <p class="field-label">Message Update Frequency</p>
          <div class="options-row">
            {#each messageFrequencyOptions as option}
              <button
                class="option-btn {config.user.defaultMessageFrequency === option ? 'active' : ''}"
                type="button"
                on:click={() => {
                  config = {
                    ...config,
                    user: { ...config.user, defaultMessageFrequency: option },
                  };
                }}
              >
                {option}
              </button>
            {/each}
          </div>

          <p class="field-label">Git Strategy</p>
          <div class="options-row">
            {#each gitStrategyOptions as option}
              <button
                class="option-btn {config.user.gitStrategy === option ? 'active' : ''}"
                type="button"
                on:click={() => {
                  config = {
                    ...config,
                    user: { ...config.user, gitStrategy: option },
                  };
                }}
              >
                {gitStrategyLabels[option]}
              </button>
            {/each}
          </div>
        </section>
      {:else if activeSection === "agent"}
        <section class="card agent-card">
          <div class="card-head agent-head">
            <h2>Agent</h2>
            <button class="btn-sync" on:click={checkAgents} disabled={isCheckingCli || isLoading || isSaving}>
              {isCheckingCli ? "Checking..." : "Check"}
            </button>
          </div>

          <div class="agent-status-grid">
            <div class="agent-row">
              <strong>OpenCode CLI</strong>
              <span class="badge {config.agents.opencode.enabled ? 'on' : 'off'}">
                {config.agents.opencode.enabled ? "Enabled" : "Disabled"}
              </span>
              {#if cliCheckResult}
                <span class="check-result {cliCheckResult.opencode ? 'ok' : 'bad'}">
                  {cliCheckResult.opencode ? "Installed" : "Not found"}
                </span>
              {/if}
            </div>

            <div class="agent-row">
              <strong>Claude CLI</strong>
              <span class="badge {config.agents.claudecode.enabled ? 'on' : 'off'}">
                {config.agents.claudecode.enabled ? "Enabled" : "Disabled"}
              </span>
              {#if cliCheckResult}
                <span class="check-result {cliCheckResult.claude ? 'ok' : 'bad'}">
                  {cliCheckResult.claude ? "Installed" : "Not found"}
                </span>
              {/if}
            </div>
          </div>

          <div class="models-section">
            <div class="section-header">
              <h3>OpenCode Models</h3>
              <span class="hint-text">One model per line</span>
            </div>
            <textarea id="agent-opencode-models" rows="8" bind:value={opencodeModelsText}></textarea>
          </div>
        </section>
      {:else}
        <section class="card">
          {#if selectedWorkspace}
            <div class="card-head">
              <h2>{selectedWorkspace.name || selectedWorkspace.id}</h2>
              <button
                on:click={() => syncSlackWorkspace(selectedWorkspace.id)}
                disabled={isSyncingSlack || isLoading || isSaving}
              >
                {isSyncingSlack ? "Syncing..." : "Sync"}
              </button>
            </div>

            <label for="workspace-app-token">Slack App Token</label>
            <input id="workspace-app-token" type="password" bind:value={selectedWorkspace.slackAppToken} />

            <label for="workspace-bot-token">Slack Bot Token</label>
            <input id="workspace-bot-token" type="password" bind:value={selectedWorkspace.slackBotToken} />

            <label for="workspace-name">Workspace Name</label>
            <input id="workspace-name" bind:value={selectedWorkspace.name} />

            <label for="workspace-domain">Domain</label>
            <input id="workspace-domain" bind:value={selectedWorkspace.domain} />

            <h3>Channels</h3>
            {#each selectedWorkspace.channelDetails as channel}
              <div class="channel">
                <strong>{channel.name || channel.id}</strong>

                <label for={`channel-agent-${channel.id}`}>Agent</label>
                <select
                  id={`channel-agent-${channel.id}`}
                  value={ensureAgentEnabled(getChannelProvider(channel))}
                  on:change={(event) => onChannelProviderChange(selectedWorkspace.id, channel.id, event)}
                >
                  {#each enabledProviders as provider}
                    <option value={provider}>{providerLabels[provider]}</option>
                  {/each}
                </select>

                {#if shouldShowChannelModel(channel)}
                  <label for={`channel-model-${channel.id}`}>Model</label>
                  <input id={`channel-model-${channel.id}`} bind:value={channel.model} placeholder="openai/gpt-5.3-codex" />
                {/if}

                <label for={`channel-working-directory-${channel.id}`}>Working directory</label>
                <input
                  id={`channel-working-directory-${channel.id}`}
                  bind:value={channel.workingDirectory}
                  placeholder="~/Code/project"
                />
              </div>
            {/each}
          {:else}
            <h2>Slack Workspaces</h2>
            <p class="empty-tip">No workspace found yet.</p>
          {/if}
        </section>
      {/if}

      <footer class="actions">
        <button on:click={loadConfig} disabled={isLoading || isSaving || isSyncingSlack || isCheckingCli}>Reload</button>
        <button on:click={saveConfig} disabled={isLoading || isSaving || isSyncingSlack || isCheckingCli}>Save</button>
      </footer>

      {#if message}
        <p class="message">{message}</p>
      {/if}
    </section>
    </div>
  </div>
</main>

<style>
  :global(body) {
    background: var(--bg);
  }

  .container {
    width: 100%;
    max-width: 1080px;
    margin: 0 auto;
    padding: 24px;
    box-sizing: border-box;
  }

  .navbar {
    height: 64px;
    border: 1px solid var(--line);
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0 24px;
    background: var(--card);
    border-radius: 8px;
    margin-bottom: 16px;
    box-shadow: var(--shadow-soft);
  }

  .navbar-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--ink);
    text-align: center;
  }

  .navbar-actions {
    display: flex;
    justify-content: flex-end;
  }

  .layout {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
    gap: 18px;
  }

  .card {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
    background: var(--card);
    box-shadow: var(--shadow-soft);
    display: grid;
    gap: 10px;
  }

  .sidebar {
    display: grid;
    gap: 8px;
    align-self: start;
    position: sticky;
    top: 24px;
  }

  .workspace-group {
    border-top: 1px solid var(--line);
    margin-top: 6px;
    padding-top: 10px;
    display: grid;
    gap: 8px;
  }

  .workspace-group p {
    margin: 0;
    font-size: 12px;
    color: var(--ink-soft);
  }

  .nav-item {
    width: 100%;
    text-align: left;
    padding: 9px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--ink);
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
  }

  .nav-item:hover {
    border-color: var(--accent-muted);
    transform: translateY(-1px);
  }

  .nav-item.active {
    border-color: var(--accent);
    background: var(--bg-soft);
  }

  .content {
    display: grid;
    gap: 14px;
  }

  .content :global(h2) {
    margin: 0 0 8px;
  }

  .content :global(h3) {
    margin: 10px 0 0;
  }

  .field-label {
    margin: 0;
    font-weight: 600;
  }

  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .options-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .option-btn {
    min-width: 100px;
  }

  .option-btn.active {
    border-color: var(--accent);
    background: var(--bg-soft);
  }

  .agent-row {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .agent-card {
    gap: 14px;
  }

  .agent-head {
    margin-bottom: 2px;
  }

  .agent-status-grid {
    display: grid;
    gap: 10px;
  }

  .models-section {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px;
    background: var(--bg-soft);
    display: grid;
    gap: 8px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .hint-text {
    font-size: 12px;
    color: var(--ink-soft);
  }

  .btn-sync {
    background: var(--bg-soft);
    border: 1px solid var(--line);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    min-width: auto;
  }

  .btn-sync:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    border: 1px solid var(--line);
  }

  .badge.on {
    border-color: #2f855a;
    color: #2f855a;
  }

  .badge.off {
    border-color: #e53e3e;
    color: #e53e3e;
  }

  .check-result {
    font-size: 12px;
    color: var(--ink-soft);
  }

  .check-result.ok {
    color: #2f855a;
  }

  .check-result.bad {
    color: #e53e3e;
  }

  .channel {
    display: grid;
    gap: 6px;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px;
    margin-top: 8px;
    background: var(--bg-soft);
  }

  input,
  select,
  textarea,
  button {
    font: inherit;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--ink);
  }

  button {
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
  }

  button:hover:not(:disabled) {
    border-color: var(--accent-muted);
    transform: translateY(-1px);
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .message,
  .empty-tip {
    margin: 0;
    color: var(--ink-soft);
  }

  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: static;
    }
  }

  @media (max-width: 768px) {
    .container {
      padding: 16px;
    }

    .navbar {
      padding: 0 12px;
    }

    .navbar-title {
      font-size: 16px;
    }
  }
</style>
