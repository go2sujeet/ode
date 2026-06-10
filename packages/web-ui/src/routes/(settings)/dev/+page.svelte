<script lang="ts">
  import { onMount } from "svelte";
  import { ExternalLink, Play, RefreshCw } from "lucide-svelte";
  import { Badge, Button, Card, Input, Label, Select, Textarea } from "$lib/components/ui";
  import { locale } from "$lib/i18n";
  import { localSettingStore } from "$lib/local-setting/store";
  import {
    AGENT_PROVIDERS,
    AGENT_PROVIDER_LABELS,
  } from "@/shared/agent-provider";

  type TaskPlatform = "slack" | "discord" | "lark";
  type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

  type TaskRecord = {
    id: string;
    title: string;
    scheduledAt: number;
    platform: TaskPlatform;
    workspaceId: string | null;
    workspaceName: string | null;
    channelId: string;
    channelName: string | null;
    threadId: string | null;
    messageText: string;
    agent: string | null;
    status: TaskStatus;
    lastError: string | null;
    triggeredAt: number | null;
    completedAt: number | null;
    createdAt: number;
    updatedAt: number;
  };

  type TaskChannelOption = {
    value: string;
    platform: TaskPlatform;
    workspaceId: string;
    workspaceName: string;
    channelId: string;
    channelName: string;
    label: string;
  };

  type TaskPayload = {
    tasks: TaskRecord[];
    channels: TaskChannelOption[];
  };

  type PresetId = "smoke" | "status" | "question";

  const PRESETS: Record<PresetId, { title: string; prompt: string }> = {
    smoke: {
      title: "Dev smoke test",
      prompt: "Inspect the current directory, create or update dev-smoke.txt with the current date and the dev run id, then reply with the file path.",
    },
    status: {
      title: "Live status test",
      prompt: "Run a visible multi-step coding-agent test: inspect the repository, read the README, create or update dev-live-status.txt with a short summary, and report what changed.",
    },
    question: {
      title: "Question loop test",
      prompt: "Before editing files, ask me one short multiple-choice question with two options about what note to write. After I answer in this thread, create or update dev-question-loop.txt with the chosen note and report the file path.",
    },
  };

  let channels = $state<TaskChannelOption[]>([]);
  let tasks = $state<TaskRecord[]>([]);
  let selectedChannel = $state("");
  let selectedAgent = $state("");
  let selectedPreset = $state<PresetId>("smoke");
  let title = $state(PRESETS.smoke.title);
  let prompt = $state(PRESETS.smoke.prompt);
  let activeTaskId = $state<string | null>(null);
  let activeRunMarker = $state("");
  let message = $state("");
  let isLoading = $state(false);
  let isStarting = $state(false);

  const activeTask = $derived(tasks.find((task) => task.id === activeTaskId) ?? null);
  const enabledAgentProviders = $derived(
    AGENT_PROVIDERS.filter((provider) => {
      const agents = $localSettingStore.config.agents as Record<string, { enabled?: boolean }>;
      return agents[provider]?.enabled === true;
    })
  );

  function t(en: string, zh: string): string {
    return $locale === "zh-CN" ? zh : en;
  }

  function getStatusVariant(status: TaskStatus): "secondary" | "success" | "destructive" | "outline" {
    if (status === "success") return "success";
    if (status === "failed") return "destructive";
    if (status === "cancelled") return "outline";
    return "secondary";
  }

  function formatTime(value: number | null | undefined): string {
    if (!value || !Number.isFinite(value)) return "n/a";
    return new Date(value).toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US");
  }

  function applyPreset(preset: PresetId): void {
    selectedPreset = preset;
    title = PRESETS[preset].title;
    prompt = PRESETS[preset].prompt;
  }

  async function loadTasks(): Promise<void> {
    isLoading = true;
    try {
      const response = await fetch("/api/tasks");
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: TaskPayload;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || "Failed to load dev task data");
      }
      channels = payload.result.channels;
      tasks = payload.result.tasks;
      if (!selectedChannel && channels.length > 0) {
        selectedChannel = channels[0]!.value;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      isLoading = false;
    }
  }

  function buildRunPrompt(runMarker: string): string {
    return `[${runMarker}]\n\n${prompt.trim()}`;
  }

  async function startRun(): Promise<void> {
    if (!$localSettingStore.devEnabled || !selectedChannel || !prompt.trim()) return;
    isStarting = true;
    message = "";
    const runMarker = `ODE_DEV_RUN:${crypto.randomUUID()}`;
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || "Dev agent run",
          scheduledAt: Date.now(),
          channelId: selectedChannel,
          threadId: null,
          messageText: buildRunPrompt(runMarker),
          agent: selectedAgent || null,
          runImmediately: true,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: TaskPayload & { task?: TaskRecord };
      };
      if (!response.ok || !payload.ok || !payload.result?.task) {
        throw new Error(payload.error || "Failed to start dev run");
      }
      activeTaskId = payload.result.task.id;
      activeRunMarker = runMarker;
      tasks = payload.result.tasks;
      channels = payload.result.channels;
      message = t("Dev run started.", "开发测试已启动。");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      isStarting = false;
    }
  }

  onMount(() => {
    let timer: number | undefined;
    void (async () => {
      if (!$localSettingStore.loaded) {
        await localSettingStore.loadConfig();
      }
      if (!$localSettingStore.devEnabled) return;
      await loadTasks();
      timer = window.setInterval(() => {
        if (activeTaskId) void loadTasks();
      }, 2500);
    })();
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
    };
  });
</script>

{#if !$localSettingStore.loaded || $localSettingStore.isLoading}
  <Card className="p-5">
    <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("Loading...", "加载中...")}</p>
  </Card>
{:else if !$localSettingStore.devEnabled}
  <Card className="p-5">
    <h2 class="text-lg font-semibold">{t("Not found", "未找到")}</h2>
  </Card>
{:else}
  <Card className="p-5">
    <div class="mb-5">
      <h2 class="text-lg font-semibold">{t("Dev Tools", "开发工具")}</h2>
      <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Agent live-message test runs", "Agent live message 测试")}</p>
    </div>

    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="space-y-4">
        <div class="grid gap-2">
          <Label for="dev-channel">{t("Target channel", "目标频道")}</Label>
          <Select id="dev-channel" bind:value={selectedChannel} disabled={isLoading || channels.length === 0}>
            {#each channels as channel}
              <option value={channel.value}>{channel.label}</option>
            {/each}
          </Select>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="dev-agent">{t("Agent", "Agent")}</Label>
            <Select id="dev-agent" bind:value={selectedAgent}>
              <option value="">{t("Channel default", "频道默认")}</option>
              {#each enabledAgentProviders as provider}
                <option value={provider}>{AGENT_PROVIDER_LABELS[provider]}</option>
              {/each}
            </Select>
          </div>

          <div class="grid gap-2">
            <Label for="dev-preset">{t("Preset", "预设")}</Label>
            <Select
              id="dev-preset"
              bind:value={selectedPreset}
              on:change={(event) => {
                const value = (event.currentTarget as HTMLSelectElement).value;
                if (value === "smoke" || value === "status" || value === "question") applyPreset(value);
              }}
            >
              <option value="smoke">{t("Smoke", "基础")}</option>
              <option value="status">{t("Live status", "动态状态")}</option>
              <option value="question">{t("Question loop", "问题循环")}</option>
            </Select>
          </div>
        </div>

        <div class="grid gap-2">
          <Label for="dev-title">{t("Title", "标题")}</Label>
          <Input id="dev-title" bind:value={title} />
        </div>

        <div class="grid gap-2">
          <Label for="dev-prompt">{t("Prompt", "Prompt")}</Label>
          <Textarea id="dev-prompt" bind:value={prompt} className="min-h-44 font-mono text-sm" />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button type="button" on:click={() => void startRun()} disabled={isStarting || !selectedChannel || !prompt.trim()}>
            <Play class="h-4 w-4" />
            {isStarting ? t("Starting...", "启动中...") : t("Start run", "开始测试")}
          </Button>
          <Button type="button" variant="outline" on:click={() => void loadTasks()} disabled={isLoading}>
            <RefreshCw class="h-4 w-4" />
            {t("Refresh", "刷新")}
          </Button>
          <a class="inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm hover:bg-[hsl(var(--muted)/0.45)]" href="/tasks">
            <ExternalLink class="h-4 w-4" />
            {t("Tasks", "一次性任务")}
          </a>
        </div>
      </div>

      <aside class="space-y-3">
        <div class="rounded-lg border p-4">
          <div class="mb-2 flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold">{t("Active run", "当前测试")}</h3>
            {#if activeTask}
              <Badge variant={getStatusVariant(activeTask.status)}>{activeTask.status}</Badge>
            {/if}
          </div>
          {#if activeTask}
            <div class="space-y-2 text-sm">
              <p class="break-all font-mono text-xs text-[hsl(var(--muted-foreground))]">{activeTask.id}</p>
              <p>{activeTask.workspaceName || activeTask.workspaceId || "workspace"} / {activeTask.channelName || activeTask.channelId}</p>
              <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Started", "开始")} {formatTime(activeTask.triggeredAt ?? activeTask.createdAt)}</p>
              {#if activeRunMarker}
                <p class="break-all rounded-md bg-[hsl(var(--muted)/0.55)] p-2 font-mono text-xs">{activeRunMarker}</p>
              {/if}
              {#if activeTask.lastError}
                <p class="rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive)/0.08)] p-2 text-xs text-[hsl(var(--destructive))]">{activeTask.lastError}</p>
              {/if}
            </div>
          {:else}
            <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("No active run", "暂无测试")}</p>
          {/if}
        </div>

        {#if message}
          <div class="rounded-lg border p-3 text-sm text-[hsl(var(--muted-foreground))]">{message}</div>
        {/if}

        <div class="rounded-lg border p-4">
          <h3 class="mb-2 text-sm font-semibold">{t("Recent dev tasks", "最近测试任务")}</h3>
          <div class="space-y-2">
            {#each tasks.filter((task) => task.title.toLowerCase().includes("dev")).slice(0, 6) as task}
              <button
                type="button"
                class="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-[hsl(var(--muted)/0.45)]"
                onclick={() => activeTaskId = task.id}
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate">{task.title}</span>
                  <Badge variant={getStatusVariant(task.status)}>{task.status}</Badge>
                </div>
                <p class="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">{task.channelName || task.channelId}</p>
              </button>
            {/each}
          </div>
        </div>
      </aside>
    </div>
  </Card>
{/if}
