<script lang="ts">
  import { TOOL_DISPLAY_CONFIG, type GitStrategy, type StatusMessageFormat } from "$lib/localConfig";
  import { Button, Card } from "$lib/components/ui";
  import { localSettingStore } from "$lib/local-setting/store";

  const statusMessageFormatOptions = Object.keys(TOOL_DISPLAY_CONFIG) as StatusMessageFormat[];
  const gitStrategyOptions: GitStrategy[] = ["worktree", "default"];
  const gitStrategyLabels: Record<GitStrategy, string> = {
    worktree: "Worktree",
    default: "Default",
  };
</script>

<Card className="p-5">
  <div class="mb-4 flex items-center justify-between gap-2">
    <h2 class="text-lg font-semibold">General</h2>
    <div class="flex items-center gap-2">
      <Button
        on:click={() => void localSettingStore.saveConfig()}
        disabled={$localSettingStore.isLoading || $localSettingStore.isSaving || $localSettingStore.isSyncingSlack || $localSettingStore.isAddingWorkspace || $localSettingStore.isCheckingCli}
      >
        Save
      </Button>
    </div>
  </div>

  <div class="grid gap-5">
    <div class="grid gap-2">
      <p class="text-sm font-medium">Status Message Format</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">Minimum shows concise progress, Medium balances progress and details, Aggressive includes the most detailed live updates.</p>
      <div class="flex flex-wrap gap-2">
        {#each statusMessageFormatOptions as option}
          <Button
            variant={$localSettingStore.config.user.defaultStatusMessageFormat === option ? "default" : "outline"}
            type="button"
            on:click={() => {
              localSettingStore.updateConfig((config) => ({
                ...config,
                user: { ...config.user, defaultStatusMessageFormat: option },
              }));
            }}
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </Button>
        {/each}
      </div>
    </div>

    <div class="grid gap-2">
      <p class="text-sm font-medium">Git Strategy</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">Worktree will create different worktree folders under `.worktree` folder for each chat thread.</p>
      <div class="flex flex-wrap gap-2">
        {#each gitStrategyOptions as option}
          <Button
            variant={$localSettingStore.config.user.gitStrategy === option ? "default" : "outline"}
            type="button"
            on:click={() => {
              localSettingStore.updateConfig((config) => ({
                ...config,
                user: { ...config.user, gitStrategy: option },
              }));
            }}
          >
            {gitStrategyLabels[option]}
          </Button>
        {/each}
      </div>
    </div>
  </div>
</Card>
