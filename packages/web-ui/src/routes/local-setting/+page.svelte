<script lang="ts">
  import { onMount } from "svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { defaultDashboardConfig, type DashboardConfig } from "$lib/localConfig";

  type AgentProvider = "opencode" | "claudecode";

  export let data: { config: DashboardConfig } | undefined;

  let config: DashboardConfig = data?.config ?? defaultDashboardConfig;
  let isLoading = false;
  let isSaving = false;
  let message = "";
  let opencodeModelsText = "";

  const providerLabels: Record<AgentProvider, string> = {
    opencode: "OpenCode",
    claudecode: "Claude Code",
  };

  $: enabledProviders = (Object.keys(providerLabels) as AgentProvider[]).filter((provider) => {
    if (provider === "opencode") return config.agents.opencode.enabled;
    return config.agents.claudecode.enabled;
  });

  $: opencodeModelsText = config.agents.opencode.models.join("\n");

  function normalizeConfig(input: DashboardConfig): DashboardConfig {
    return {
      ...input,
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

  async function loadConfig(): Promise<void> {
    isLoading = true;
    message = "";
    try {
      const response = await fetch("/api/config");
      const payload = await response.json();
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

  async function saveConfig(): Promise<void> {
    isSaving = true;
    message = "";
    config = {
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
        body: JSON.stringify(config),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Failed to save config");
      }
      config = normalizeConfig(payload.config as DashboardConfig);
      message = "Saved.";
    } catch (error) {
      message = `Save failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isSaving = false;
    }
  }

  function ensureAgentEnabled(provider: AgentProvider): AgentProvider {
    if (enabledProviders.includes(provider)) return provider;
    return enabledProviders[0] ?? "opencode";
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

  function getChannelProvider(channel: { agentProvider?: string }): AgentProvider {
    const provider = channel.agentProvider;
    if (provider === "claudecode") return provider;
    return "opencode";
  }

  function onChannelProviderChange(workspaceId: string, channelId: string, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const provider = value === "claudecode" ? value : "opencode";
    setChannelProvider(workspaceId, channelId, provider);
  }

  onMount(() => {
    if (!data?.config) {
      void loadConfig();
    } else {
      config = normalizeConfig(data.config);
    }
  });
</script>

<main class="page">
  <header class="header">
    <h1>Ode Settings</h1>
    <ThemeToggle />
  </header>

  <section class="card">
    <h2>Profile</h2>
    <label>Name</label>
    <input bind:value={config.user.name} />
    <label>Email</label>
    <input bind:value={config.user.email} />
  </section>

  <section class="card">
    <h2>Agents</h2>
    <label><input type="checkbox" bind:checked={config.agents.opencode.enabled} /> OpenCode enabled</label>
    <label><input type="checkbox" bind:checked={config.agents.claudecode.enabled} /> Claude Code enabled</label>
    <label>OpenCode models (one per line)</label>
    <textarea rows="8" bind:value={opencodeModelsText}></textarea>
  </section>

  <section class="card">
    <h2>Workspaces</h2>
    {#each config.workspaces as workspace}
      <div class="workspace">
        <h3>{workspace.name || workspace.id}</h3>
        {#each workspace.channelDetails as channel}
          <div class="channel">
            <strong>{channel.name || channel.id}</strong>
            <label>Agent</label>
            <select
              value={ensureAgentEnabled(getChannelProvider(channel))}
              on:change={(event) =>
                onChannelProviderChange(
                  workspace.id,
                  channel.id,
                  event
                )}
            >
              {#each enabledProviders as provider}
                <option value={provider}>{providerLabels[provider]}</option>
              {/each}
            </select>

            {#if channel.agentProvider === "opencode"}
              <label>Model</label>
              <input bind:value={channel.model} placeholder="openai/gpt-5.2-codex" />
            {/if}

            <label>Working directory</label>
            <input bind:value={channel.workingDirectory} placeholder="~/Code/project" />
          </div>
        {/each}
      </div>
    {/each}
  </section>

  <footer class="actions">
    <button on:click={loadConfig} disabled={isLoading || isSaving}>Reload</button>
    <button on:click={saveConfig} disabled={isLoading || isSaving}>Save</button>
  </footer>

  {#if message}
    <p class="message">{message}</p>
  {/if}
</main>

<style>
  .page { max-width: 980px; margin: 0 auto; padding: 24px; }
  .header { display: flex; align-items: center; justify-content: space-between; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-top: 16px; display: grid; gap: 8px; }
  .workspace { border-top: 1px solid #eee; padding-top: 12px; margin-top: 12px; }
  .channel { display: grid; gap: 6px; border: 1px solid #eee; border-radius: 6px; padding: 10px; margin-top: 8px; }
  input, select, textarea, button { font: inherit; padding: 8px; }
  .actions { display: flex; gap: 8px; margin-top: 16px; }
  .message { margin-top: 12px; }
</style>
