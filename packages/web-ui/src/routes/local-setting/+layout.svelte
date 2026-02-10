<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import ThemeToggle from "$lib/components/ThemeToggle.svelte";
  import { localSettingStore } from "$lib/local-setting/store";
  import { getSelectedWorkspace, getWorkspacePath } from "$lib/local-setting/workspaces";

  let pathname = "/local-setting";
  let normalizedPathname = pathname;
  let activeSection: "general" | "agents" | "slack" = "general";
  let pendingSlackAppToken = "";
  let pendingSlackBotToken = "";
  let isAddWorkspaceDialogOpen = false;

  $: pathname = $page.url.pathname;
  $: normalizedPathname = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  $: activeSection =
    normalizedPathname === "/local-setting/agents"
      ? "agents"
      : normalizedPathname.startsWith("/local-setting/slack-bot")
        ? "slack"
        : "general";

  $: selectedWorkspace = getSelectedWorkspace($page.params.workspaceName ?? "", $localSettingStore.config.workspaces);

  async function addWorkspace(): Promise<void> {
    const workspace = await localSettingStore.discoverSlackWorkspace(
      pendingSlackAppToken,
      pendingSlackBotToken
    );
    if (!workspace) return;
    pendingSlackAppToken = "";
    pendingSlackBotToken = "";
    isAddWorkspaceDialogOpen = false;
    await goto(getWorkspacePath(workspace));
  }

  function openAddWorkspaceDialog(): void {
    isAddWorkspaceDialogOpen = true;
  }

  function closeAddWorkspaceDialog(): void {
    isAddWorkspaceDialogOpen = false;
  }

  function onPendingSlackAppTokenInput(event: Event): void {
    pendingSlackAppToken = (event.currentTarget as HTMLInputElement).value;
  }

  function onPendingSlackBotTokenInput(event: Event): void {
    pendingSlackBotToken = (event.currentTarget as HTMLInputElement).value;
  }

  function removeWorkspace(workspaceId: string): void {
    const workspaces = $localSettingStore.config.workspaces;
    const removingIndex = workspaces.findIndex((workspace) => workspace.id === workspaceId);
    if (removingIndex < 0) return;

    const workspaceToRemove = workspaces[removingIndex];
    const workspaceLabel = workspaceToRemove?.name?.trim() || workspaceToRemove?.id || workspaceId;
    if (!window.confirm(`Remove workspace '${workspaceLabel}'?`)) {
      return;
    }

    const remainingWorkspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);
    localSettingStore.removeWorkspace(workspaceId);

    if (activeSection !== "slack" || selectedWorkspace?.id !== workspaceId) return;

    const nextWorkspace =
      remainingWorkspaces[removingIndex]
      ?? remainingWorkspaces[removingIndex - 1]
      ?? remainingWorkspaces[0]
      ?? null;

    if (nextWorkspace) {
      void goto(getWorkspacePath(nextWorkspace), { replaceState: true });
      return;
    }

    void goto("/local-setting", { replaceState: true });
  }

  onMount(() => {
    if (!$localSettingStore.loaded) {
      void localSettingStore.loadConfig();
    }
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
        <button class="nav-item {activeSection === 'general' ? 'active' : ''}" on:click={() => goto('/local-setting')}>
          General
        </button>
        <button class="nav-item {activeSection === 'agents' ? 'active' : ''}" on:click={() => goto('/local-setting/agents')}>
          Agents
        </button>

        <div class="workspace-group">
          <p>Slack Workspace</p>
          {#if $localSettingStore.config.workspaces.length === 0}
            <span class="empty-tip">No workspaces</span>
          {:else}
            {#each $localSettingStore.config.workspaces as workspace}
              <button
                class="nav-item {selectedWorkspace?.id === workspace.id && activeSection === 'slack' ? 'active' : ''}"
                on:click={() => goto(getWorkspacePath(workspace))}
              >
                {workspace.name || workspace.id}
              </button>
            {/each}
          {/if}

          <button
            class="nav-item add-workspace"
            type="button"
            on:click={openAddWorkspaceDialog}
            disabled={$localSettingStore.isLoading || $localSettingStore.isSaving || $localSettingStore.isSyncingSlack || $localSettingStore.isAddingWorkspace || $localSettingStore.isCheckingCli}
          >
            Add Workspace
          </button>
        </div>
      </aside>

      <section class="content">
        <slot />

        <footer class="actions">
          {#if activeSection === "slack" && selectedWorkspace}
            <button
              class="danger-action"
              type="button"
              on:click={() => removeWorkspace(selectedWorkspace.id)}
              disabled={$localSettingStore.isLoading || $localSettingStore.isSaving || $localSettingStore.isSyncingSlack || $localSettingStore.isAddingWorkspace || $localSettingStore.isCheckingCli}
            >
              Remove Workspace
            </button>
          {/if}
          <button
            on:click={() => void localSettingStore.saveConfig()}
            disabled={$localSettingStore.isLoading || $localSettingStore.isSaving || $localSettingStore.isSyncingSlack || $localSettingStore.isAddingWorkspace || $localSettingStore.isCheckingCli}
          >
            Save
          </button>
        </footer>

        {#if $localSettingStore.message}
          <p class="message">{$localSettingStore.message}</p>
        {/if}
      </section>
    </div>
  </div>
</main>

{#if isAddWorkspaceDialogOpen}
  <div class="dialog-backdrop" role="presentation" on:click={closeAddWorkspaceDialog}>
    <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="add-workspace-title" on:click|stopPropagation>
      <h2 id="add-workspace-title">Add Workspace</h2>

      <label for="new-workspace-app-token">Slack App Token</label>
      <input
        id="new-workspace-app-token"
        type="text"
        value={pendingSlackAppToken}
        on:input={onPendingSlackAppTokenInput}
        placeholder="xapp-..."
      />

      <label for="new-workspace-bot-token">Slack Bot Token</label>
      <input
        id="new-workspace-bot-token"
        type="text"
        value={pendingSlackBotToken}
        on:input={onPendingSlackBotTokenInput}
        placeholder="xoxb-..."
      />

      <div class="dialog-actions">
        <button type="button" on:click={closeAddWorkspaceDialog}>Cancel</button>
        <button
          type="button"
          on:click={() => void addWorkspace()}
          disabled={$localSettingStore.isLoading || $localSettingStore.isSaving || $localSettingStore.isSyncingSlack || $localSettingStore.isAddingWorkspace || $localSettingStore.isCheckingCli}
        >
          {$localSettingStore.isAddingWorkspace ? "Adding..." : "Add Workspace"}
        </button>
      </div>
    </div>
  </div>
{/if}

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

  :global(.card) {
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

  .add-workspace {
    border-style: dashed;
  }

  .content {
    display: grid;
    gap: 14px;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .danger-action {
    border-color: #bf3a2b;
    color: #bf3a2b;
  }

  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 24%, transparent);
    display: grid;
    place-items: center;
    z-index: 50;
    padding: 16px;
  }

  .dialog {
    width: min(520px, 100%);
    margin: 0;
  }

  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .message,
  .empty-tip {
    margin: 0;
    color: var(--ink-soft);
  }

  :global(.card h2) {
    margin: 0 0 8px;
  }

  :global(.card h3) {
    margin: 10px 0 0;
  }

  :global(input),
  :global(select),
  :global(button) {
    font: inherit;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--ink);
  }

  :global(button) {
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
  }

  :global(button:hover:not(:disabled)) {
    border-color: var(--accent-muted);
    transform: translateY(-1px);
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
