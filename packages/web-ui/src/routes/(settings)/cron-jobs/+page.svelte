<script lang="ts">
  import { onMount } from "svelte";
  import { AlarmClock, Pencil, Play, Plus, RefreshCw, Trash2 } from "lucide-svelte";
  import { Badge, Button, Card, Input, Label, Select, Textarea } from "$lib/components/ui";
  import { locale } from "$lib/i18n";

  type CronJobPlatform = "slack" | "discord" | "lark" | "github";
  type CronJobRunStatus = "idle" | "running" | "success" | "failed";

  type CronJobRecord = {
    id: string;
    title: string;
    cronExpression: string;
    platform: CronJobPlatform;
    workspaceId: string | null;
    workspaceName: string | null;
    channelId: string;
    channelName: string | null;
    messageText: string;
    enabled: boolean;
    lastTriggeredAt: number | null;
    lastCompletedAt: number | null;
    lastRunStatus: CronJobRunStatus;
    lastError: string | null;
    createdAt: number;
    updatedAt: number;
  };

  type CronJobChannelOption = {
    value: string;
    platform: CronJobPlatform;
    workspaceId: string;
    workspaceName: string;
    channelId: string;
    channelName: string;
    label: string;
  };

  type CronJobPayload = {
    jobs: CronJobRecord[];
    channels: CronJobChannelOption[];
  };

  type CronPresetKind = "hourly" | "daily" | "weekdays" | "custom";

  let jobs = $state<CronJobRecord[]>([]);
  let channels = $state<CronJobChannelOption[]>([]);
  let isLoading = $state(false);
  let isSaving = $state(false);
  let message = $state("");

  let editingJobId = $state<string | null>(null);
  let formTitle = $state("");
  let formChannelId = $state("");
  let formMessageText = $state("");
  let formEnabled = $state(true);
  // Only meaningful when creating (not editing). When true, the server kicks
  // off one run immediately after saving in addition to scheduling future
  // runs per the cron expression.
  let formRunImmediately = $state(false);
  // Per-job transient state so the "Run Now" button can show a spinner /
  // disabled state while the POST /run request is in flight.
  let runningJobIds = $state<Set<string>>(new Set());

  // Cron expression state is driven by a preset picker plus a few
  // auxiliary fields. `formCustomExpression` holds the raw string when the
  // user picks "custom" — otherwise it is recomputed from the preset.
  let formPresetKind = $state<CronPresetKind>("daily");
  let formHourlyMinute = $state(0); // 0..59
  let formDailyHour = $state(9); // 0..23
  let formDailyMinute = $state(0); // 0..59
  let formWeekdaysHour = $state(9);
  let formWeekdaysMinute = $state(0);
  let formCustomExpression = $state("0 9 * * 1-5");

  const formCronExpression = $derived.by(() => {
    switch (formPresetKind) {
      case "hourly":
        return `${clampMinute(formHourlyMinute)} * * * *`;
      case "daily":
        return `${clampMinute(formDailyMinute)} ${clampHour(formDailyHour)} * * *`;
      case "weekdays":
        return `${clampMinute(formWeekdaysMinute)} ${clampHour(formWeekdaysHour)} * * 1-5`;
      case "custom":
      default:
        return formCustomExpression;
    }
  });

  function clampHour(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(23, Math.max(0, Math.floor(value)));
  }

  function clampMinute(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(59, Math.max(0, Math.floor(value)));
  }

  function t(en: string, zh: string): string {
    return $locale === "zh-CN" ? zh : en;
  }

  function formatTimestamp(timestamp: number | null | undefined): string {
    if (!timestamp || !Number.isFinite(timestamp)) return t("Never", "从未");
    return new Date(timestamp).toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US");
  }

  function getRunStatusVariant(status: CronJobRunStatus): "secondary" | "success" | "destructive" {
    if (status === "success") return "success";
    if (status === "failed") return "destructive";
    return "secondary";
  }

  function getRunStatusLabel(status: CronJobRunStatus): string {
    if (status === "running") return t("Running", "运行中");
    if (status === "success") return t("Success", "成功");
    if (status === "failed") return t("Failed", "失败");
    return t("Idle", "空闲");
  }

  function getEnabledLabel(enabled: boolean): string {
    return enabled ? t("Enabled", "已启用") : t("Disabled", "已停用");
  }

  function getChannelLabel(job: CronJobRecord): string {
    const workspace = job.workspaceName || job.workspaceId || t("Unknown workspace", "未知工作区");
    const channel = job.channelName || job.channelId;
    return `${workspace} / ${channel}`;
  }

  function findChannelFormValue(job: CronJobRecord): string {
    const exactMatch = channels.find((channel) =>
      channel.channelId === job.channelId
      && channel.workspaceId === (job.workspaceId || channel.workspaceId)
      && channel.platform === job.platform
    );
    if (exactMatch) return exactMatch.value;

    const fallbackMatch = channels.find((channel) => channel.channelId === job.channelId);
    return fallbackMatch?.value ?? job.channelId;
  }

  function applyPayload(payload: CronJobPayload): void {
    jobs = payload.jobs;
    channels = payload.channels;

    const hasSelectedChannel = channels.some((channel) => channel.value === formChannelId);
    if (!hasSelectedChannel) {
      formChannelId = channels[0]?.value ?? "";
    }
  }

  /**
   * Try to decode a cron expression back into one of the presets the
   * picker supports. Unmatched expressions fall through to "custom" and
   * leave `formCustomExpression` intact so the user can edit the raw
   * string.
   */
  function applyExpressionToForm(expression: string): void {
    const trimmed = expression.trim();
    formCustomExpression = trimmed || "0 9 * * 1-5";
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 5) {
      formPresetKind = "custom";
      return;
    }
    const [minute, hour, dom, month, dow] = parts;
    if (month !== "*" || dom !== "*") {
      formPresetKind = "custom";
      return;
    }
    const minuteNum = Number(minute);
    const hourNum = Number(hour);
    if (
      hour === "*"
      && dow === "*"
      && Number.isInteger(minuteNum)
      && minuteNum >= 0
      && minuteNum <= 59
    ) {
      formPresetKind = "hourly";
      formHourlyMinute = minuteNum;
      return;
    }
    if (
      Number.isInteger(minuteNum)
      && minuteNum >= 0
      && minuteNum <= 59
      && Number.isInteger(hourNum)
      && hourNum >= 0
      && hourNum <= 23
    ) {
      if (dow === "*") {
        formPresetKind = "daily";
        formDailyHour = hourNum;
        formDailyMinute = minuteNum;
        return;
      }
      if (dow === "1-5") {
        formPresetKind = "weekdays";
        formWeekdaysHour = hourNum;
        formWeekdaysMinute = minuteNum;
        return;
      }
    }
    formPresetKind = "custom";
  }

  function resetForm(): void {
    editingJobId = null;
    formTitle = "";
    formChannelId = channels[0]?.value ?? "";
    formMessageText = "";
    formEnabled = true;
    formRunImmediately = false;
    applyExpressionToForm("0 9 * * *");
  }

  function startEdit(job: CronJobRecord): void {
    editingJobId = job.id;
    formTitle = job.title;
    formChannelId = findChannelFormValue(job);
    formMessageText = job.messageText;
    formEnabled = job.enabled;
    formRunImmediately = false;
    applyExpressionToForm(job.cronExpression);
    message = "";
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function loadCronJobs(): Promise<void> {
    isLoading = true;
    message = "";
    try {
      const response = await fetch("/api/cron-jobs");
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: CronJobPayload;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || "Failed to load cron jobs");
      }
      applyPayload(payload.result);
      if (!editingJobId && !formChannelId && payload.result.channels.length > 0) {
        formChannelId = payload.result.channels[0]!.value;
      }
    } catch (error) {
      message = `Cron jobs load failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isLoading = false;
    }
  }

  async function saveCronJob(): Promise<void> {
    if (channels.length === 0) {
      message = t("Add a workspace channel first before creating cron jobs.", "请先添加工作区和频道，再创建定时任务。");
      return;
    }

    isSaving = true;
    message = "";
    try {
      const isCreate = !editingJobId;
      const body: Record<string, unknown> = {
        title: formTitle,
        cronExpression: formCronExpression,
        channelId: formChannelId,
        messageText: formMessageText,
        enabled: formEnabled,
      };
      if (isCreate && formRunImmediately) {
        body.runImmediately = true;
      }
      const response = await fetch(editingJobId ? `/api/cron-jobs/${encodeURIComponent(editingJobId)}` : "/api/cron-jobs", {
        method: editingJobId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: CronJobPayload;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || "Failed to save cron job");
      }
      applyPayload(payload.result);
      if (isCreate) {
        message = formRunImmediately
          ? t("Cron job created and triggered.", "定时任务已创建并立即执行一次。")
          : t("Cron job created.", "定时任务已创建。");
      } else {
        message = t("Cron job updated.", "定时任务已更新。");
      }
      resetForm();
    } catch (error) {
      message = `Cron job save failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isSaving = false;
    }
  }

  async function runJobNow(job: CronJobRecord): Promise<void> {
    if (runningJobIds.has(job.id)) return;

    // Clone to a new Set so Svelte picks up the change.
    runningJobIds = new Set(runningJobIds).add(job.id);
    message = "";
    try {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(job.id)}/run`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: CronJobPayload;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        if (response.status === 409) {
          message = t("This cron job is already running.", "该定时任务正在运行中。");
        } else {
          throw new Error(payload.error || "Failed to run cron job");
        }
      } else {
        applyPayload(payload.result);
        message = t("Cron job triggered.", "定时任务已触发运行。");
      }
    } catch (error) {
      message = `Cron job run failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      const next = new Set(runningJobIds);
      next.delete(job.id);
      runningJobIds = next;
    }
  }

  async function removeCronJob(job: CronJobRecord): Promise<void> {
    const confirmText = $locale === "zh-CN"
      ? `确认删除定时任务「${job.title}」？`
      : `Delete cron job '${job.title}'?`;
    if (!window.confirm(confirmText)) return;

    isSaving = true;
    message = "";
    try {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(job.id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: CronJobPayload;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || "Failed to delete cron job");
      }
      applyPayload(payload.result);
      if (editingJobId === job.id) {
        resetForm();
      }
      message = t("Cron job deleted.", "定时任务已删除。");
    } catch (error) {
      message = `Cron job delete failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isSaving = false;
    }
  }

  onMount(() => {
    void loadCronJobs();
  });

  const hourOptions = Array.from({ length: 24 }, (_, i) => i);
  const minuteOptions = Array.from({ length: 60 }, (_, i) => i);
</script>

<Card className="p-5">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <AlarmClock class="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
      <h2 class="text-lg font-semibold">{t("Cron Jobs", "定时任务")}</h2>
    </div>

    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        on:click={resetForm}
        disabled={isSaving}
      >
        <Plus class="h-4 w-4" />
        {t("New Job", "新建任务")}
      </Button>
      <Button
        variant="outline"
        on:click={() => void loadCronJobs()}
        disabled={isLoading}
      >
        <RefreshCw class="h-4 w-4" />
        {isLoading ? t("Loading...", "加载中...") : t("Refresh", "刷新")}
      </Button>
    </div>
  </div>

  <div class="space-y-6">
    <!-- Create / edit form -->
    <div class="rounded-lg border p-4">
      <div class="mb-4">
        <p class="text-sm font-medium">
          {editingJobId ? t("Edit Cron Job", "编辑定时任务") : t("Create Cron Job", "创建定时任务")}
        </p>
      </div>

      <div class="space-y-4">
        <div class="space-y-2">
          <Label for="cron-title">{t("Title", "标题")}</Label>
          <Input
            id="cron-title"
            value={formTitle}
            placeholder={t("Morning standup summary", "早会摘要")}
            on:input={(event) => {
              formTitle = (event.currentTarget as HTMLInputElement).value;
            }}
          />
        </div>

        <div class="space-y-2">
          <Label for="cron-preset">{t("Schedule", "执行频率")}</Label>
          <Select
            id="cron-preset"
            bind:value={formPresetKind}
          >
            <option value="hourly">{t("Every hour", "每小时")}</option>
            <option value="daily">{t("Every day at…", "每天某个时间点")}</option>
            <option value="weekdays">{t("Weekdays (Mon–Fri) at…", "工作日（周一到周五）某个时间点")}</option>
            <option value="custom">{t("Custom cron expression", "自定义 Cron 表达式")}</option>
          </Select>

          {#if formPresetKind === "hourly"}
            <div class="flex items-center gap-2 text-sm">
              <span class="text-[hsl(var(--muted-foreground))]">{t("Minute of hour", "每小时第")}</span>
              <Select
                bind:value={formHourlyMinute}
                className="max-w-[100px]"
              >
                {#each minuteOptions as m}
                  <option value={m}>{String(m).padStart(2, "0")}</option>
                {/each}
              </Select>
              <span class="text-[hsl(var(--muted-foreground))]">{t("min", "分钟")}</span>
            </div>
          {:else if formPresetKind === "daily"}
            <div class="flex items-center gap-2 text-sm">
              <span class="text-[hsl(var(--muted-foreground))]">{t("At", "时间")}</span>
              <Select bind:value={formDailyHour} className="max-w-[100px]">
                {#each hourOptions as h}
                  <option value={h}>{String(h).padStart(2, "0")}</option>
                {/each}
              </Select>
              <span class="text-[hsl(var(--muted-foreground))]">:</span>
              <Select bind:value={formDailyMinute} className="max-w-[100px]">
                {#each minuteOptions as m}
                  <option value={m}>{String(m).padStart(2, "0")}</option>
                {/each}
              </Select>
            </div>
          {:else if formPresetKind === "weekdays"}
            <div class="flex items-center gap-2 text-sm">
              <span class="text-[hsl(var(--muted-foreground))]">{t("At", "时间")}</span>
              <Select bind:value={formWeekdaysHour} className="max-w-[100px]">
                {#each hourOptions as h}
                  <option value={h}>{String(h).padStart(2, "0")}</option>
                {/each}
              </Select>
              <span class="text-[hsl(var(--muted-foreground))]">:</span>
              <Select bind:value={formWeekdaysMinute} className="max-w-[100px]">
                {#each minuteOptions as m}
                  <option value={m}>{String(m).padStart(2, "0")}</option>
                {/each}
              </Select>
            </div>
          {:else}
            <Input
              id="cron-expression"
              value={formCustomExpression}
              placeholder="0 9 * * 1-5"
              on:input={(event) => {
                formCustomExpression = (event.currentTarget as HTMLInputElement).value;
              }}
            />
            <p class="text-xs text-[hsl(var(--muted-foreground))]">
              {t("Standard 5-field cron syntax, e.g. `*/15 * * * *` for every 15 minutes.", "标准 5 段 Cron 表达式，例如 `*/15 * * * *` 每 15 分钟一次。")}
            </p>
          {/if}

          <p class="text-xs text-[hsl(var(--muted-foreground))]">
            {t("Resolved expression", "最终表达式")}: <code>{formCronExpression}</code>
          </p>
        </div>

        <div class="space-y-2">
          <Label for="cron-channel">{t("Channel", "频道")}</Label>
          <Select id="cron-channel" bind:value={formChannelId} disabled={channels.length === 0}>
            {#if channels.length === 0}
              <option value="">{t("No available channels", "暂无可用频道")}</option>
            {:else}
              {#each channels as channel}
                <option value={channel.value}>
                  {channel.label} ({channel.platform})
                </option>
              {/each}
            {/if}
          </Select>
        </div>

        <div class="space-y-2">
          <Label for="cron-message">{t("Message", "消息")}</Label>
          <Textarea
            id="cron-message"
            className="min-h-[180px]"
            value={formMessageText}
            placeholder={t("Review the open PRs in this workspace and summarize blockers.", "检查当前工作区里打开的 PR，并总结 blocker。")}
            on:input={(event) => {
              formMessageText = (event.currentTarget as HTMLTextAreaElement).value;
            }}
          />
        </div>

        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={formEnabled}
            onchange={(event) => {
              formEnabled = (event.currentTarget as HTMLInputElement).checked;
            }}
          />
          <span>{t("Enable this cron job immediately", "创建后立即生效")}</span>
        </label>

        {#if !editingJobId}
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={formRunImmediately}
              onchange={(event) => {
                formRunImmediately = (event.currentTarget as HTMLInputElement).checked;
              }}
            />
            <span>{t("Also run this job once right after creating", "创建后立即执行一次")}</span>
          </label>
        {/if}

        <div class="flex flex-wrap items-center gap-2">
          <Button
            on:click={() => void saveCronJob()}
            disabled={isSaving || channels.length === 0}
          >
            {isSaving
              ? t("Saving...", "保存中...")
              : editingJobId
                ? t("Update Job", "更新任务")
                : t("Create Job", "创建任务")}
          </Button>
          {#if editingJobId}
            <Button
              variant="outline"
              on:click={resetForm}
              disabled={isSaving}
            >
              {t("Cancel Edit", "取消编辑")}
            </Button>
          {/if}
        </div>
      </div>
    </div>

    <!-- Job list -->
    <div class="rounded-lg border p-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <p class="text-sm font-medium">{t("Scheduled Jobs", "任务列表")}</p>
        <Badge variant="outline">{jobs.length} {t("jobs", "个任务")}</Badge>
      </div>

      {#if isLoading && jobs.length === 0}
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("Loading cron jobs...", "正在加载定时任务...")}</p>
      {:else if jobs.length === 0}
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("No cron jobs yet.", "还没有定时任务。")}</p>
      {:else}
        <div class="space-y-3">
          {#each jobs as job}
            <div class="rounded-lg border p-4">
              <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div class="space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant={job.enabled ? "success" : "secondary"}>{getEnabledLabel(job.enabled)}</Badge>
                    <Badge variant={getRunStatusVariant(job.lastRunStatus)}>{getRunStatusLabel(job.lastRunStatus)}</Badge>
                    <Badge variant="outline">{job.platform}</Badge>
                  </div>
                  <p class="text-sm font-medium">{job.title}</p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">
                    {t("Cron", "Cron")}: <code>{job.cronExpression}</code>
                  </p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">{getChannelLabel(job)}</p>
                </div>

                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    on:click={() => void runJobNow(job)}
                    disabled={isSaving || runningJobIds.has(job.id)}
                  >
                    <Play class="h-3.5 w-3.5" />
                    {runningJobIds.has(job.id)
                      ? t("Running...", "运行中...")
                      : t("Run Now", "立即执行")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    on:click={() => startEdit(job)}
                  >
                    <Pencil class="h-3.5 w-3.5" />
                    {t("Edit", "编辑")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    on:click={() => void removeCronJob(job)}
                    disabled={isSaving}
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                    {t("Delete", "删除")}
                  </Button>
                </div>
              </div>

              <div class="rounded-md bg-[hsl(var(--muted)/0.4)] p-3">
                <p class="mb-1 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{t("Message", "消息内容")}</p>
                <p class="text-sm leading-6 whitespace-pre-wrap">{job.messageText}</p>
              </div>

              <div class="mt-3 grid gap-2 text-xs text-[hsl(var(--muted-foreground))] md:grid-cols-2">
                <p>{t("Last triggered", "上次触发")}: {formatTimestamp(job.lastTriggeredAt)}</p>
                <p>{t("Last completed", "上次完成")}: {formatTimestamp(job.lastCompletedAt)}</p>
                <p>{t("Created", "创建于")}: {formatTimestamp(job.createdAt)}</p>
                <p>{t("Updated", "更新于")}: {formatTimestamp(job.updatedAt)}</p>
              </div>

              {#if job.lastError}
                <div class="mt-3 rounded-md border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] p-3 text-sm text-[hsl(var(--destructive))]">
                  {job.lastError}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if message}
    <p class="mt-4 text-sm text-[hsl(var(--muted-foreground))]">{message}</p>
  {/if}
</Card>
