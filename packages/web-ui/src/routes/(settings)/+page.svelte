<script lang="ts">
  import { TOOL_DISPLAY_CONFIG, type GitStrategy, type StatusMessageFormat } from "$lib/localConfig";
  import { Button, Card } from "$lib/components/ui";
  import ToggleGroup from "$lib/components/ui/toggle-group.svelte";
  import { localSettingStore } from "$lib/local-setting/store";

  const statusMessageFormatOptions = Object.keys(TOOL_DISPLAY_CONFIG) as StatusMessageFormat[];
  const statusMessageFormatItems = statusMessageFormatOptions.map((option) => ({
    value: option,
    label: option.charAt(0).toUpperCase() + option.slice(1),
  }));
  const gitStrategyItems: Array<{ value: GitStrategy; label: string }> = [
    { value: "worktree", label: "Worktree" },
    { value: "default", label: "Default" },
  ];
</script>

<Card className="p-5">
  <div class="mb-4 flex items-center justify-between gap-2">
    <h2 class="text-lg font-semibold">General</h2>
  </div>

  <div class="grid gap-5">
    <div class="grid gap-2">
      <p class="text-sm font-medium">Status Message Format</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">Minimum shows concise progress, Medium balances progress and details, Aggressive includes the most detailed live updates.</p>
      <div class="inline-block w-fit">
        <ToggleGroup
          items={statusMessageFormatItems}
          value={$localSettingStore.config.user.defaultStatusMessageFormat}
          onValueChange={(nextValue: string) => {
            const nextFormat = nextValue as StatusMessageFormat;
            localSettingStore.updateConfig((config) => ({
              ...config,
              user: { ...config.user, defaultStatusMessageFormat: nextFormat },
            }));
          }}
        />
      </div>
    </div>

    <div class="grid gap-2">
      <p class="text-sm font-medium">Git Strategy</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">Worktree will create different worktree folders under `.worktree` folder for each chat thread.</p>
      <div class="inline-block w-fit">
        <ToggleGroup
          items={gitStrategyItems}
          value={$localSettingStore.config.user.gitStrategy}
          onValueChange={(nextValue: string) => {
            const nextStrategy = nextValue as GitStrategy;
            localSettingStore.updateConfig((config) => ({
              ...config,
              user: { ...config.user, gitStrategy: nextStrategy },
            }));
          }}
        />
      </div>
    </div>
  </div>

  <div class="mt-5 flex justify-end">
    <Button
      on:click={() => void localSettingStore.saveConfig()}
      disabled={$localSettingStore.isLoading || $localSettingStore.isSaving || $localSettingStore.isSyncingSlack || $localSettingStore.isAddingWorkspace || $localSettingStore.isCheckingCli}
    >
      Save
    </Button>
  </div>
</Card>
