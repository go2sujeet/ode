<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { localSettingStore } from "$lib/local-setting/store";
  import { getSelectedWorkspace, getWorkspacePath, slugify } from "$lib/local-setting/workspaces";

  type AgentProvider = "opencode" | "claudecode" | "codex" | "kimi";

  const providerLabels: Record<AgentProvider, string> = {
    opencode: "OpenCode",
    claudecode: "Claude Code",
    codex: "Codex",
    kimi: "Kimi",
  };

  let isCanonicalizingWorkspaceRoute = false;

  $: selectedWorkspace = getSelectedWorkspace($page.params.workspaceName ?? "", $localSettingStore.config.workspaces);
  $: enabledProviders = (Object.keys(providerLabels) as AgentProvider[]).filter((provider) => {
    if (provider === "opencode") return $localSettingStore.config.agents.opencode.enabled;
    if (provider === "claudecode") return $localSettingStore.config.agents.claudecode.enabled;
    if (provider === "codex") return $localSettingStore.config.agents.codex.enabled;
    return $localSettingStore.config.agents.kimi.enabled;
  });
  $: maybeCanonicalizeWorkspaceRoute();

  function maybeCanonicalizeWorkspaceRoute(): void {
    if ($localSettingStore.isLoading || isCanonicalizingWorkspaceRoute || !selectedWorkspace) return;
    const currentWorkspaceName = $page.params.workspaceName ?? "";
    const canonicalPath = getWorkspacePath(selectedWorkspace);
    const canonicalWorkspaceName = slugify(selectedWorkspace.name) || "workspace-1";
    if (decodeURIComponent(currentWorkspaceName) === canonicalWorkspaceName) return;

    isCanonicalizingWorkspaceRoute = true;
    void goto(canonicalPath, { replaceState: true, noScroll: true, keepFocus: true }).finally(() => {
      isCanonicalizingWorkspaceRoute = false;
    });
  }

  function getChannelProvider(channel: { agentProvider?: string }): AgentProvider {
    if (channel.agentProvider === "claudecode") return "claudecode";
    if (channel.agentProvider === "codex") return "codex";
    if (channel.agentProvider === "kimi") return "kimi";
    return "opencode";
  }

  function ensureAgentEnabled(provider: AgentProvider): AgentProvider {
    if (enabledProviders.includes(provider)) return provider;
    return enabledProviders[0] ?? "opencode";
  }

  function shouldShowChannelModel(channel: { agentProvider?: string }): boolean {
    return getChannelProvider(channel) === "opencode";
  }

  function onWorkspaceFieldInput(
    workspaceId: string,
    field: "name" | "domain" | "slackAppToken" | "slackBotToken",
    value: string
  ): void {
    localSettingStore.updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      [field]: value,
    }));
  }

  function onChannelProviderChange(workspaceId: string, channelId: string, event: Event): void {
    const selected = (event.currentTarget as HTMLSelectElement).value;
    const provider = selected === "claudecode"
      ? "claudecode"
      : selected === "codex"
        ? "codex"
        : selected === "kimi"
          ? "kimi"
        : "opencode";
    localSettingStore.updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      channelDetails: workspace.channelDetails.map((channel) => {
        if (channel.id !== channelId) return channel;
        return {
          ...channel,
          agentProvider: provider,
          model: provider === "opencode"
            ? channel.model || $localSettingStore.config.agents.opencode.models[0] || ""
            : "",
        };
      }),
    }));
  }

  function onChannelModelChange(workspaceId: string, channelId: string, model: string): void {
    localSettingStore.updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      channelDetails: workspace.channelDetails.map((channel) =>
        channel.id === channelId ? { ...channel, model } : channel
      ),
    }));
  }

  function onChannelWorkingDirectoryChange(workspaceId: string, channelId: string, workingDirectory: string): void {
    localSettingStore.updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      channelDetails: workspace.channelDetails.map((channel) =>
        channel.id === channelId ? { ...channel, workingDirectory } : channel
      ),
    }));
  }
</script>

{#if selectedWorkspace}
  <section class="card">
    <div class="card-head">
      <h2>{selectedWorkspace.name || "Workspace 1"}</h2>
      <button
        on:click={() => void localSettingStore.syncSlackWorkspace(selectedWorkspace.id)}
        disabled={$localSettingStore.isSyncingSlack || $localSettingStore.isLoading || $localSettingStore.isSaving}
      >
        {$localSettingStore.isSyncingSlack ? "Syncing..." : "Sync"}
      </button>
    </div>

    <label for="workspace-app-token">Slack App Token</label>
    <input
      id="workspace-app-token"
      type="text"
      value={selectedWorkspace.slackAppToken ?? ""}
      on:input={(event) => onWorkspaceFieldInput(selectedWorkspace.id, "slackAppToken", (event.currentTarget as HTMLInputElement).value)}
    />

    <label for="workspace-bot-token">Slack Bot Token</label>
    <input
      id="workspace-bot-token"
      type="text"
      value={selectedWorkspace.slackBotToken ?? ""}
      on:input={(event) => onWorkspaceFieldInput(selectedWorkspace.id, "slackBotToken", (event.currentTarget as HTMLInputElement).value)}
    />
  </section>

  <section class="card">
    <label for="workspace-name">Workspace Name</label>
    <input
      id="workspace-name"
      value={selectedWorkspace.name}
      on:input={(event) => onWorkspaceFieldInput(selectedWorkspace.id, "name", (event.currentTarget as HTMLInputElement).value)}
    />

    <label for="workspace-domain">Domain</label>
    <input
      id="workspace-domain"
      value={selectedWorkspace.domain}
      on:input={(event) => onWorkspaceFieldInput(selectedWorkspace.id, "domain", (event.currentTarget as HTMLInputElement).value)}
    />
  </section>

  <section class="card">
    <h3>Channels</h3>
    {#each selectedWorkspace.channelDetails as channel}
      <div class="channel">
        <strong>{channel.name || channel.id}</strong>

        <div class="channel-inline">
          <div class="channel-field">
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
          </div>

          {#if shouldShowChannelModel(channel)}
            <div class="channel-field">
              <label for={`channel-model-${channel.id}`}>Model</label>
              <select
                id={`channel-model-${channel.id}`}
                value={channel.model}
                on:change={(event) => onChannelModelChange(selectedWorkspace.id, channel.id, (event.currentTarget as HTMLSelectElement).value)}
              >
                {#if !$localSettingStore.config.agents.opencode.models.includes(channel.model) && channel.model}
                  <option value={channel.model}>{channel.model}</option>
                {/if}
                {#each $localSettingStore.config.agents.opencode.models as model}
                  <option value={model}>{model}</option>
                {/each}
              </select>
            </div>
          {/if}
        </div>

        <label for={`channel-working-directory-${channel.id}`}>Working directory</label>
        <input
          id={`channel-working-directory-${channel.id}`}
          value={channel.workingDirectory}
          placeholder="~/Code/project"
          on:input={(event) =>
            onChannelWorkingDirectoryChange(
              selectedWorkspace.id,
              channel.id,
              (event.currentTarget as HTMLInputElement).value
            )}
        />
      </div>
    {/each}
  </section>
{:else}
  <section class="card">
    <h2>Slack Workspace</h2>
    <p class="empty-tip">No workspace found yet.</p>
  </section>
{/if}

<style>
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
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

  .channel-inline {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .channel-field {
    display: grid;
    gap: 6px;
  }

  @media (max-width: 768px) {
    .channel-inline {
      grid-template-columns: 1fr;
    }
  }
</style>
