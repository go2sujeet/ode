<script lang="ts">
  import {
    DEFAULT_STATUS_MESSAGE_FREQUENCY_MS,
    STATUS_MESSAGE_FREQUENCY_OPTIONS,
    TOOL_DISPLAY_CONFIG,
    type DashboardConfig,
    type GitStrategy,
    type StatusMessageFrequencyMs,
    type StatusMessageFrequencyValue,
    type StatusMessageFormat,
    parseStatusMessageFrequencyMs,
    toStatusMessageFrequencyValue,
  } from "$lib/localConfig";
  import { Button, Card } from "$lib/components/ui";
  import ToggleGroup from "$lib/components/ui/toggle-group.svelte";
  import { locale } from "$lib/i18n";
  import { localSettingStore } from "$lib/local-setting/store";

  function t(en: string, zh: string): string {
    return $locale === "zh-CN" ? zh : en;
  }

  const statusMessageFormatOptions = Object.keys(TOOL_DISPLAY_CONFIG) as StatusMessageFormat[];
  const statusMessageFormatItems = statusMessageFormatOptions.map((option) => ({
    value: option,
    label: option.charAt(0).toUpperCase() + option.slice(1),
  }));
  const gitStrategyItems: Array<{ value: GitStrategy; label: string }> = [
    { value: "worktree", label: "Worktree" },
    { value: "default", label: "Default" },
  ];
  const statusMessageFrequencyItems: Array<{ value: StatusMessageFrequencyValue; label: string }> =
    STATUS_MESSAGE_FREQUENCY_OPTIONS.map((option: (typeof STATUS_MESSAGE_FREQUENCY_OPTIONS)[number]) => ({
      value: option.value,
      label: option.label,
    }));
  const autoUpdateItems: Array<{ value: "on" | "off"; label: string }> = [
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ];

  function parseStatusMessageFrequencySelection(value: string): StatusMessageFrequencyMs {
    return parseStatusMessageFrequencyMs(Number(value));
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
    const nextMs = parseStatusMessageFrequencySelection(nextValue);
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
    <div>
      <h2 class="text-lg font-semibold">{t("General", "通用")}</h2>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Current version", "当前版本")}: {$localSettingStore.appVersion || t("unknown", "未知")}</p>
    </div>
  </div>

  <div class="grid gap-5">
    <div class="grid gap-2">
      <p class="text-sm font-medium">{t("Status Message Format", "状态消息格式")}</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Minimum shows concise progress, Medium balances progress and details, Aggressive includes the most detailed live updates.", "Minimum 显示简洁进度，Medium 平衡进度与细节，Aggressive 提供最详细的实时更新。")}</p>
      <div class="inline-block w-fit">
        <ToggleGroup
          items={statusMessageFormatItems}
          value={$localSettingStore.config.user.defaultStatusMessageFormat}
          onValueChange={handleStatusFormatChange}
        />
      </div>
    </div>

    <div class="grid gap-2">
      <p class="text-sm font-medium">{t("Status Message Frequency", "状态消息频率")}</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Controls how often status messages refresh while a request is running.", "控制请求执行时状态消息的刷新频率。")}</p>
      <div class="inline-block w-fit">
        <ToggleGroup
          items={statusMessageFrequencyItems}
          value={toStatusMessageFrequencyValue($localSettingStore.config.user.statusMessageFrequencyMs ?? DEFAULT_STATUS_MESSAGE_FREQUENCY_MS)}
          onValueChange={handleStatusFrequencyChange}
        />
      </div>
    </div>

    <div class="grid gap-2">
      <p class="text-sm font-medium">{t("Git Strategy", "Git 策略")}</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Worktree will create different worktree folders under `.worktree` folder for each chat thread.", "Worktree 会为每个会话线程在 `.worktree` 目录下创建独立工作目录。")}</p>
      <div class="inline-block w-fit">
        <ToggleGroup
          items={gitStrategyItems}
          value={$localSettingStore.config.user.gitStrategy}
          onValueChange={handleGitStrategyChange}
        />
      </div>
    </div>

    <div class="grid gap-2">
      <p class="text-sm font-medium">{t("Auto Update", "自动更新")}</p>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Controls whether Ode automatically checks for and applies updates.", "控制 Ode 是否自动检查并应用更新。")}</p>
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
      {t("Save", "保存")}
    </Button>
  </div>
</Card>
