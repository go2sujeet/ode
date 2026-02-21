<script lang="ts">
  import {
    TOOL_DISPLAY_CONFIG,
    type DashboardConfig,
    type GitStrategy,
    type StatusMessageFormat,
  } from "$lib/localConfig";
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
  const statusMessageFrequencyItems: Array<{ value: "2000" | "5000" | "10000"; label: string }> = [
    { value: "2000", label: "2 seconds" },
    { value: "5000", label: "5 seconds" },
    { value: "10000", label: "10 seconds" },
  ];
  const autoUpdateItems: Array<{ value: "on" | "off"; label: string }> = [
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ];

  function parseStatusMessageFrequencyMs(value: string): 2000 | 5000 | 10000 {
    if (value === "5000") return 5000;
    if (value === "10000") return 10000;
    return 2000;
  }

  function parseStatusMessageFormat(value: string): StatusMessageFormat {
    if (value === "minimum" || value === "aggressive") return value;
    return "medium";
  }

  function parseGitStrategyValue(value: string): GitStrategy {
    return value === "default" ? "default" : "worktree";
  }

  function handleStatusFormatChange(nextValue: string): void {
    const nextFormat = parseStatusMessageFormat(nextValue);
    localSettingStore.updateConfig((config: DashboardConfig) => ({
      ...config,
      user: { ...config.user, defaultStatusMessageFormat: nextFormat },
    }));
  }

  function handleStatusFrequencyChange(nextValue: string): void {
    const nextMs = parseStatusMessageFrequencyMs(nextValue);
    localSettingStore.updateConfig((config: DashboardConfig) => ({
      ...config,
      user: { ...config.user, statusMessageFrequencyMs: nextMs },
    }));
  }

  function handleGitStrategyChange(nextValue: string): void {
    const nextStrategy = parseGitStrategyValue(nextValue);
    localSettingStore.updateConfig((config: DashboardConfig) => ({
      ...config,
      user: { ...config.user, gitStrategy: nextStrategy },
    }));
  }

  function handleAutoUpdateChange(nextValue: string): void {
    localSettingStore.updateConfig((config: DashboardConfig) => ({
      ...config,
      updates: {
        ...config.updates,
        autoUpgrade: nextValue !== "off",
      },
    }));
  }
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
          onValueChange={handleStatusFormatChange}
        />
      </div>
    </div>

    <div class="grid gap-2">
      <p class="text-sm font-medium">Status Message Frequency</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">Controls how often status messages refresh while a request is running.</p>
      <div class="inline-block w-fit">
        <ToggleGroup
          items={statusMessageFrequencyItems}
          value={String($localSettingStore.config.user.statusMessageFrequencyMs ?? 2000)}
          onValueChange={handleStatusFrequencyChange}
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
          onValueChange={handleGitStrategyChange}
        />
      </div>
    </div>

    <div class="grid gap-2">
      <p class="text-sm font-medium">Auto Update</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">Controls whether Ode automatically checks for and applies updates.</p>
      <div class="inline-block w-fit">
        <ToggleGroup
          items={autoUpdateItems}
          value={$localSettingStore.config.updates.autoUpgrade === false ? "off" : "on"}
          onValueChange={handleAutoUpdateChange}
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
