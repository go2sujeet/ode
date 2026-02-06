<script lang="ts">
  import { TOOL_DISPLAY_CONFIG, type GitStrategy, type MessageFrequency } from "$lib/localConfig";
  import { localSettingStore } from "$lib/local-setting/store";

  const messageFrequencyOptions = Object.keys(TOOL_DISPLAY_CONFIG) as MessageFrequency[];
  const gitStrategyOptions: GitStrategy[] = ["worktree", "default"];
  const gitStrategyLabels: Record<GitStrategy, string> = {
    worktree: "Worktree",
    default: "Default",
  };
</script>

<section class="card">
  <h2>Profile</h2>
  <div class="field-group">
    <p class="field-label">Message Update Frequency</p>
    <div class="options-row">
      {#each messageFrequencyOptions as option}
        <button
          class="option-btn {$localSettingStore.config.user.defaultMessageFrequency === option ? 'active' : ''}"
          type="button"
          on:click={() => {
            localSettingStore.updateConfig((config) => ({
              ...config,
              user: { ...config.user, defaultMessageFrequency: option },
            }));
          }}
        >
          {option}
        </button>
      {/each}
    </div>
  </div>

  <div class="field-group">
    <p class="field-label">Git Strategy</p>
    <div class="options-row">
      {#each gitStrategyOptions as option}
        <button
          class="option-btn {$localSettingStore.config.user.gitStrategy === option ? 'active' : ''}"
          type="button"
          on:click={() => {
            localSettingStore.updateConfig((config) => ({
              ...config,
              user: { ...config.user, gitStrategy: option },
            }));
          }}
        >
          {gitStrategyLabels[option]}
        </button>
      {/each}
    </div>
  </div>
</section>

<style>
  .field-group {
    display: grid;
    gap: 10px;
  }

  .field-label {
    margin: 0;
    font-weight: 600;
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
</style>
