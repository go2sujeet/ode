<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import type { DashboardConfig } from "$lib/localConfig";
  import { localSettingStore } from "$lib/local-setting/store";
  import { getSelectedWorkspace, getWorkspacePath, slugify } from "$lib/local-setting/workspaces";

  type AgentProvider = "opencode" | "claudecode" | "codex" | "kimi" | "kiro" | "qwen";

  const providerLabels: Record<AgentProvider, string> = {
    opencode: "OpenCode",
    claudecode: "Claude Code",
    codex: "Codex",
    kimi: "Kimi",
    kiro: "Kiro",
    qwen: "Qwen Code",
  };

  const agentProviders = Object.keys(providerLabels) as AgentProvider[];

  function parseAgentProvider(value: unknown): AgentProvider {
    return typeof value === "string" && agentProviders.includes(value as AgentProvider)
      ? value as AgentProvider
      : "opencode";
  }

  function isProviderEnabled(provider: AgentProvider): boolean {
    if (provider === "opencode") return $localSettingStore.config.agents.opencode.enabled;
    if (provider === "claudecode") return $localSettingStore.config.agents.claudecode.enabled;
    if (provider === "codex") return $localSettingStore.config.agents.codex.enabled;
    if (provider === "kimi") return $localSettingStore.config.agents.kimi.enabled;
    if (provider === "kiro") return $localSettingStore.config.agents.kiro.enabled;
    return $localSettingStore.config.agents.qwen.enabled;
  }

  let isCanonicalizingWorkspaceRoute = false;

  $: selectedWorkspace = getSelectedWorkspace($page.params.workspaceName ?? "", $localSettingStore.config.workspaces);
  $: duplicateWorkspaceIds = getDuplicateWorkspaceIds($localSettingStore.config.workspaces);
  $: duplicateSlackBotTokens = getDuplicateSlackBotTokens($localSettingStore.config.workspaces);
  $: selectedWorkspaceErrors = getWorkspaceErrors(selectedWorkspace, duplicateWorkspaceIds, duplicateSlackBotTokens);
  $: enabledProviders = agentProviders.filter((provider) => isProviderEnabled(provider));
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
    return parseAgentProvider(channel.agentProvider);
  }

  function ensureAgentEnabled(provider: AgentProvider): AgentProvider {
    if (enabledProviders.includes(provider)) return provider;
    return enabledProviders[0] ?? "opencode";
  }

  function shouldShowChannelModel(channel: { agentProvider?: string }): boolean {
    const provider = getChannelProvider(channel);
    return getProviderModels(provider) !== null;
  }

  function getProviderModels(provider: AgentProvider): string[] | null {
    const config = $localSettingStore.config.agents as Record<string, { models?: string[] }>;
    const entry = config[provider];
    return Array.isArray(entry?.models) ? entry.models : null;
  }

  function getChannelModelSelectValue(channel: { agentProvider?: string; model: string }): string {
    const provider = getChannelProvider(channel);
    if (provider === "codex" && !channel.model) return "__default__";
    return channel.model;
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

  function onWorkspaceTextInput(
    workspaceId: string,
    field: "name" | "domain" | "slackAppToken" | "slackBotToken",
    event: Event
  ): void {
    onWorkspaceFieldInput(workspaceId, field, (event.currentTarget as HTMLInputElement).value);
  }

  function onChannelProviderChange(workspaceId: string, channelId: string, event: Event): void {
    const selected = (event.currentTarget as HTMLSelectElement).value;
    const provider = parseAgentProvider(selected);
    const providerModels = getProviderModels(provider) ?? [];
    localSettingStore.updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      channelDetails: workspace.channelDetails.map((channel) => {
        if (channel.id !== channelId) return channel;
        const nextModel = provider === "codex"
          ? (providerModels.includes(channel.model) ? channel.model : "")
          : (providerModels.length > 0
            ? (providerModels.includes(channel.model) ? channel.model : (providerModels[0] ?? ""))
            : "");
        return {
          ...channel,
          agentProvider: provider,
          model: nextModel,
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

  function onChannelModelSelect(workspaceId: string, channelId: string, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    onChannelModelChange(workspaceId, channelId, value === "__default__" ? "" : value);
  }

  function onChannelWorkingDirectoryChange(workspaceId: string, channelId: string, workingDirectory: string): void {
    localSettingStore.updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      channelDetails: workspace.channelDetails.map((channel) =>
        channel.id === channelId ? { ...channel, workingDirectory } : channel
      ),
    }));
  }

  function onChannelWorkingDirectoryInput(workspaceId: string, channelId: string, event: Event): void {
    onChannelWorkingDirectoryChange(workspaceId, channelId, (event.currentTarget as HTMLInputElement).value);
  }

  function onChannelSystemMessageChange(workspaceId: string, channelId: string, channelSystemMessage: string): void {
    localSettingStore.updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      channelDetails: workspace.channelDetails.map((channel) =>
        channel.id === channelId ? { ...channel, channelSystemMessage } : channel
      ),
    }));
  }

  function onChannelBaseBranchChange(workspaceId: string, channelId: string, baseBranch: string): void {
    localSettingStore.updateWorkspace(workspaceId, (workspace) => ({
      ...workspace,
      channelDetails: workspace.channelDetails.map((channel) =>
        channel.id === channelId ? { ...channel, baseBranch } : channel
      ),
    }));
  }

  function onChannelBaseBranchInput(workspaceId: string, channelId: string, event: Event): void {
    onChannelBaseBranchChange(workspaceId, channelId, (event.currentTarget as HTMLInputElement).value);
  }

  function onChannelSystemMessageInput(workspaceId: string, channelId: string, event: Event): void {
    onChannelSystemMessageChange(workspaceId, channelId, (event.currentTarget as HTMLTextAreaElement).value);
  }

  function getDuplicateWorkspaceIds(workspaces: DashboardConfig["workspaces"]): Set<string> {
    const counts = new Map<string, number>();
    for (const workspace of workspaces) {
      const workspaceId = workspace.id.trim();
      if (!workspaceId) continue;
      counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([id]) => id));
  }

  function getWorkspaceErrors(
    workspace: DashboardConfig["workspaces"][number] | null,
    duplicateIds: Set<string>,
    duplicateBotTokens: Set<string>
  ): string[] {
    if (!workspace) return [];
    const errors: string[] = [];
    if (!workspace.id.trim()) {
      errors.push("Workspace ID is required.");
    } else if (duplicateIds.has(workspace.id.trim())) {
      errors.push(`Workspace ID '${workspace.id}' is duplicated.`);
    }
    if (!(workspace.slackAppToken?.trim() ?? "")) {
      errors.push("Slack App Token is required.");
    }
    if (!(workspace.slackBotToken?.trim() ?? "")) {
      errors.push("Slack Bot Token is required.");
    } else if (duplicateBotTokens.has(workspace.slackBotToken.trim())) {
      errors.push("Slack Bot Token must be unique across workspaces.");
    }
    return errors;
  }

  function getDuplicateSlackBotTokens(workspaces: DashboardConfig["workspaces"]): Set<string> {
    const counts = new Map<string, number>();
    for (const workspace of workspaces) {
      const botToken = workspace.slackBotToken?.trim() ?? "";
      if (!botToken) continue;
      counts.set(botToken, (counts.get(botToken) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([token]) => token));
  }
</script>

{#if selectedWorkspace}
  <section class="card">
    <div class="card-head">
      <h2>{selectedWorkspace.name || "Workspace 1"}</h2>
      <button
        on:click={() => void localSettingStore.syncSlackWorkspace(selectedWorkspace.id)}
        disabled={$localSettingStore.isSyncingSlack || $localSettingStore.isAddingWorkspace || $localSettingStore.isLoading || $localSettingStore.isSaving}
      >
        {$localSettingStore.isSyncingSlack ? "Syncing..." : "Sync"}
      </button>
    </div>

    <label for="workspace-app-token">Slack App Token</label>
    <input
      id="workspace-app-token"
      type="text"
      value={selectedWorkspace.slackAppToken ?? ""}
      on:input={(event) => onWorkspaceTextInput(selectedWorkspace.id, "slackAppToken", event)}
    />

    <label for="workspace-bot-token">Slack Bot Token</label>
    <input
      id="workspace-bot-token"
      type="text"
      value={selectedWorkspace.slackBotToken ?? ""}
      on:input={(event) => onWorkspaceTextInput(selectedWorkspace.id, "slackBotToken", event)}
    />

    {#if selectedWorkspaceErrors.length > 0}
      <div class="validation-errors" role="alert">
        {#each selectedWorkspaceErrors as error}
          <p>{error}</p>
        {/each}
      </div>
    {/if}
  </section>

  <section class="card">
    <label for="workspace-name">Workspace Name</label>
    <input
      id="workspace-name"
      value={selectedWorkspace.name}
      on:input={(event) => onWorkspaceTextInput(selectedWorkspace.id, "name", event)}
    />

    <label for="workspace-domain">Domain</label>
    <input
      id="workspace-domain"
      value={selectedWorkspace.domain}
      on:input={(event) => onWorkspaceTextInput(selectedWorkspace.id, "domain", event)}
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
                  value={getChannelModelSelectValue(channel)}
                  on:change={(event) => onChannelModelSelect(selectedWorkspace.id, channel.id, event)}
                >
                {#if getChannelProvider(channel) === "codex"}
                  <option value="__default__">Use default (gpt-5.3-codex)</option>
                {/if}
                {#if (getProviderModels(getChannelProvider(channel)) ?? []).length === 0
                  && getChannelProvider(channel) !== "codex"}
                  <option value="" disabled>No models configured</option>
                {/if}
                {#if !(getProviderModels(getChannelProvider(channel)) ?? []).includes(channel.model) && channel.model}
                  <option value={channel.model}>{channel.model}</option>
                {/if}
                {#each getProviderModels(getChannelProvider(channel)) ?? [] as model}
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
          on:input={(event) => onChannelWorkingDirectoryInput(selectedWorkspace.id, channel.id, event)}
        />

        <label for={`channel-base-branch-${channel.id}`}>Base branch</label>
        <input
          id={`channel-base-branch-${channel.id}`}
          value={channel.baseBranch}
          placeholder="main"
          on:input={(event) => onChannelBaseBranchInput(selectedWorkspace.id, channel.id, event)}
        />

        <label for={`channel-system-message-${channel.id}`}>Channel System Message (optional)</label>
        <textarea
          id={`channel-system-message-${channel.id}`}
          rows="3"
          value={channel.channelSystemMessage ?? ""}
          placeholder="Appended to the system prompt for this channel"
          on:input={(event) => onChannelSystemMessageInput(selectedWorkspace.id, channel.id, event)}
        ></textarea>
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

  .validation-errors {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px;
    background: var(--bg-soft);
    display: grid;
    gap: 4px;
  }

  .validation-errors p {
    margin: 0;
    color: var(--accent);
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
