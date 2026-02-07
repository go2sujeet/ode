<script lang="ts">
  import { localSettingStore } from "$lib/local-setting/store";
</script>

<section class="card agent-card">
  <div class="card-head agent-head">
    <h2>Agent</h2>
    <button
      class="btn-sync"
      on:click={() => void localSettingStore.checkAgents()}
      disabled={$localSettingStore.isCheckingCli || $localSettingStore.isLoading || $localSettingStore.isSaving}
    >
      {$localSettingStore.isCheckingCli ? "Checking..." : "Check"}
    </button>
  </div>

  <div class="agent-status-grid">
    <div class="agent-row">
      <strong>Claude CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <span class="badge {$localSettingStore.cliCheckResult.claude ? 'on' : 'off'}">
          {$localSettingStore.cliCheckResult.claude ? "Installed" : "Not found"}
        </span>
      {/if}
    </div>

    <div class="agent-row">
      <strong>Codex CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <span class="badge {$localSettingStore.cliCheckResult.codex ? 'on' : 'off'}">
          {$localSettingStore.cliCheckResult.codex ? "Installed" : "Not found"}
        </span>
      {/if}
    </div>

    <div class="agent-row">
      <strong>Kimi CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <span class="badge {$localSettingStore.cliCheckResult.kimi ? 'on' : 'off'}">
          {$localSettingStore.cliCheckResult.kimi ? "Installed" : "Not found"}
        </span>
      {/if}
    </div>

    <div class="agent-row opencode-row">
      <strong>OpenCode CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <span class="badge {$localSettingStore.cliCheckResult.opencode ? 'on' : 'off'}">
          {$localSettingStore.cliCheckResult.opencode ? "Installed" : "Not found"}
        </span>
      {/if}

      <div class="model-badges">
        {#if $localSettingStore.config.agents.opencode.models.length === 0}
          <span class="badge model-badge empty">No models configured</span>
        {:else}
          {#each $localSettingStore.config.agents.opencode.models as model}
            <span class="badge model-badge">{model}</span>
          {/each}
        {/if}
      </div>
    </div>
  </div>

  {#if $localSettingStore.agentMessage}
    <p class="agent-message">{$localSettingStore.agentMessage}</p>
  {/if}
</section>

<style>
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
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

  .opencode-row {
    align-items: flex-start;
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

  .model-badges {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .model-badge {
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
  }

  .model-badge.empty {
    color: var(--ink-soft);
    border-color: var(--line);
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

  .agent-message {
    margin: 0;
    color: var(--ink-soft);
  }
</style>
