<script lang="ts">
  import { onMount } from "svelte";
  import { Inbox, RefreshCw } from "lucide-svelte";
  import { AGENT_PROVIDER_LABELS, type AgentProviderId } from "@/shared/agent-provider";
  import { Badge, Button, Card } from "$lib/components/ui";
  import { locale } from "$lib/i18n";

  type ThreadSourceKind = "user" | "cron_job";

  type MessageThreadSummary = {
    id: string;
    platform: "slack" | "discord" | "lark";
    workspaceId: string | null;
    workspaceName: string | null;
    channelId: string;
    channelName: string | null;
    rawChannelId: string | null;
    threadId: string;
    replyThreadId: string;
    sessionId: string | null;
    providerId: string | null;
    model: string | null;
    workingDirectory: string | null;
    threadOwnerUserId: string | null;
    branchName: string | null;
    sourceKind: ThreadSourceKind;
    cronJobId: string | null;
    cronJobTitle: string | null;
    detailCount: number;
    firstMessageAt: number;
    lastMessageAt: number;
    createdAt: number;
    updatedAt: number;
    latestPromptPreview: string | null;
    latestResultPreview: string | null;
    pendingDetailCount: number;
  };

  type MessageDetailKind = "user_prompt" | "agent_result" | "agent_question" | "question_reply";
  type MessageDetailStatus = "pending" | "completed" | "failed";

  type MessageDetail = {
    id: string;
    threadId: string;
    seq: number;
    kind: MessageDetailKind;
    status: MessageDetailStatus;
    isQuestion: boolean;
    questionSourceId: string | null;
    questionPayload: unknown;
    userId: string | null;
    messageId: string | null;
    promptText: string | null;
    resultText: string | null;
    errorText: string | null;
    providerId: string | null;
    model: string | null;
    workingDirectory: string | null;
    startTime: number;
    endTime: number | null;
    context: Record<string, unknown> | null;
    createdAt: number;
    updatedAt: number;
  };

  type MessageThreadDetail = MessageThreadSummary & {
    context: Record<string, unknown> | null;
    details: MessageDetail[];
  };

  type ThreadPage = {
    items: MessageThreadSummary[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };

  let threadPage = $state<ThreadPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });
  let isLoading = $state(false);
  let statusMessage = $state("");
  let selectedThreadId = $state<string | null>(null);
  let selectedThreadDetail = $state<MessageThreadDetail | null>(null);
  let isDetailLoading = $state(false);

  function t(en: string, zh: string): string {
    return $locale === "zh-CN" ? zh : en;
  }

  function formatTimestamp(timestamp: number | null | undefined): string {
    if (!timestamp || !Number.isFinite(timestamp)) return t("Unknown time", "未知时间");
    return new Date(timestamp).toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US");
  }

  function formatDuration(startMs: number, endMs: number | null): string {
    if (!endMs || !Number.isFinite(endMs) || endMs < startMs) return t("—", "—");
    const ms = endMs - startMs;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60_000);
    const secs = Math.round((ms % 60_000) / 1000);
    return `${mins}m ${secs}s`;
  }

  function getProviderLabel(providerId: string | null): string {
    if (!providerId) return t("Unknown provider", "未知 Provider");
    return AGENT_PROVIDER_LABELS[providerId as AgentProviderId] ?? providerId;
  }

  function getThreadSourceLabel(thread: MessageThreadSummary): string {
    if (thread.sourceKind === "cron_job") {
      return thread.cronJobTitle
        ? `${t("Cron Job", "定时任务")}: ${thread.cronJobTitle}`
        : t("Cron Job", "定时任务");
    }
    return t("User Thread", "用户会话");
  }

  function getThreadLocation(thread: MessageThreadSummary): string {
    const workspace = thread.workspaceName || thread.workspaceId || t("Unknown workspace", "未知工作区");
    const channel = thread.channelName || thread.channelId;
    return `${workspace} / ${channel}`;
  }

  function getDetailKindLabel(kind: MessageDetailKind): string {
    switch (kind) {
      case "user_prompt":
        return t("User prompt", "用户消息");
      case "agent_result":
        return t("Agent result", "Agent 结果");
      case "agent_question":
        return t("Agent question", "Agent 提问");
      case "question_reply":
        return t("Answer", "用户回复");
    }
  }

  function getDetailStatusVariant(status: MessageDetailStatus): "secondary" | "success" | "destructive" {
    if (status === "completed") return "success";
    if (status === "failed") return "destructive";
    return "secondary";
  }

  function getDetailBodyText(detail: MessageDetail): string {
    if (detail.kind === "agent_result") {
      return detail.resultText || detail.errorText || t("No output yet", "暂无输出");
    }
    if (detail.kind === "agent_question") {
      return JSON.stringify(detail.questionPayload ?? null, null, 2);
    }
    return detail.promptText || "";
  }

  function formatContext(context: Record<string, unknown> | null): string {
    if (!context) return "";
    return JSON.stringify(context, null, 2);
  }

  async function loadThreads(page = threadPage.page): Promise<void> {
    isLoading = true;
    statusMessage = "";
    try {
      const response = await fetch(`/api/message-threads?page=${page}&pageSize=${threadPage.pageSize}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: ThreadPage;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || "Failed to load threads");
      }
      threadPage = payload.result;
      if (selectedThreadId && !payload.result.items.some((item) => item.id === selectedThreadId)) {
        selectedThreadId = null;
        selectedThreadDetail = null;
      }
    } catch (error) {
      statusMessage = `Inbox load failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isLoading = false;
    }
  }

  async function openThread(threadId: string): Promise<void> {
    if (selectedThreadId === threadId && selectedThreadDetail) {
      selectedThreadId = null;
      selectedThreadDetail = null;
      return;
    }

    selectedThreadId = threadId;
    isDetailLoading = true;
    statusMessage = "";
    try {
      const response = await fetch(`/api/message-threads/${encodeURIComponent(threadId)}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: MessageThreadDetail;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || "Failed to load thread detail");
      }
      if (selectedThreadId === threadId) {
        selectedThreadDetail = payload.result;
      }
    } catch (error) {
      statusMessage = `Thread detail failed: ${error instanceof Error ? error.message : String(error)}`;
      if (selectedThreadId === threadId) {
        selectedThreadDetail = null;
      }
    } finally {
      isDetailLoading = false;
    }
  }

  onMount(() => {
    void loadThreads(1);
  });
</script>

<Card className="p-5">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <Inbox class="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
      <div>
        <h2 class="text-lg font-semibold">{t("Inbox", "收件箱")}</h2>
        <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Conversation threads with full prompt / result / question timelines", "会话级记录，展开可看完整的 prompt、result、提问时间线")}</p>
      </div>
    </div>

    <Button
      variant="outline"
      on:click={() => void loadThreads(threadPage.page)}
      disabled={isLoading}
    >
      <RefreshCw class="h-4 w-4" />
      {isLoading ? t("Loading...", "加载中...") : t("Refresh", "刷新")}
    </Button>
  </div>

  <div class="space-y-4">
    <div class="rounded-lg border p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-sm font-medium">{t("Thread Feed", "会话列表")}</p>
          <p class="text-xs text-[hsl(var(--muted-foreground))]">
            {t("Rolling retention of the last 100 conversation threads. Click a row to drill into details.", "最多滚动保留 100 个会话。点击展开查看所有 detail。")}
          </p>
        </div>
        <Badge variant="outline">{t("SQLite-backed", "SQLite 持久化")}</Badge>
      </div>

      {#if isLoading && threadPage.items.length === 0}
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("Loading inbox...", "正在加载收件箱...")}</p>
      {:else if threadPage.items.length === 0}
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("No threads yet.", "暂时还没有会话记录。")}</p>
      {:else}
        <div class="space-y-3">
          {#each threadPage.items as thread}
            <div class="rounded-lg border p-4">
              <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div class="space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{getThreadSourceLabel(thread)}</Badge>
                    <Badge variant="outline">{getProviderLabel(thread.providerId)}</Badge>
                    <Badge variant="outline">{thread.platform}</Badge>
                    <Badge variant={thread.pendingDetailCount > 0 ? "secondary" : "success"}>
                      {thread.pendingDetailCount > 0
                        ? `${t("Pending", "处理中")} (${thread.pendingDetailCount})`
                        : t("Idle", "已结束")}
                    </Badge>
                  </div>
                  <p class="text-sm font-medium">{getThreadLocation(thread)}</p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">
                    {t("Model", "模型")}: {thread.model || t("Default", "默认")}
                    {" · "}
                    {t("Details", "消息数")}: {thread.detailCount}
                    {" · "}
                    {t("Last", "最近活动")}: {formatTimestamp(thread.lastMessageAt)}
                  </p>
                </div>

                <Button
                  variant="outline"
                  className="shrink-0"
                  on:click={() => void openThread(thread.id)}
                >
                  {selectedThreadId === thread.id && selectedThreadDetail
                    ? t("Hide Timeline", "收起时间线")
                    : t("View Timeline", "查看时间线")}
                </Button>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-md bg-[hsl(var(--muted)/0.4)] p-3">
                  <p class="mb-1 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{t("Latest user prompt", "最新用户消息")}</p>
                  <p class="text-sm leading-6">{thread.latestPromptPreview || t("(none)", "(无)")}</p>
                </div>

                <div class="rounded-md bg-[hsl(var(--muted)/0.4)] p-3">
                  <p class="mb-1 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{t("Latest agent result", "最新 Agent 结果")}</p>
                  <p class="text-sm leading-6">
                    {thread.latestResultPreview || t("Waiting for final result.", "等待最终结果中。")}
                  </p>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p class="text-xs text-[hsl(var(--muted-foreground))]">
          {t("Total", "总计")} {threadPage.total} {t("threads", "条会话")}
          {" · "}
          {t("Page", "页码")} {threadPage.page}/{threadPage.totalPages}
        </p>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={isLoading || threadPage.page <= 1}
            on:click={() => void loadThreads(threadPage.page - 1)}
          >
            {t("Previous", "上一页")}
          </Button>
          <Button
            variant="outline"
            disabled={isLoading || threadPage.page >= threadPage.totalPages}
            on:click={() => void loadThreads(threadPage.page + 1)}
          >
            {t("Next", "下一页")}
          </Button>
        </div>
      </div>
    </div>

    {#if selectedThreadId}
      <div class="rounded-lg border p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <div>
            <p class="text-sm font-medium">{t("Thread Timeline", "会话时间线")}</p>
            <p class="text-xs text-[hsl(var(--muted-foreground))]">{selectedThreadId}</p>
          </div>
          {#if isDetailLoading}
            <Badge variant="outline">{t("Loading", "加载中")}</Badge>
          {/if}
        </div>

        {#if selectedThreadDetail}
          <div class="mb-4 flex flex-wrap gap-2">
            <Badge variant="outline">{getThreadSourceLabel(selectedThreadDetail)}</Badge>
            <Badge variant="outline">{getProviderLabel(selectedThreadDetail.providerId)}</Badge>
            <Badge variant="outline">{selectedThreadDetail.model || t("Default model", "默认模型")}</Badge>
            <Badge variant="outline">{selectedThreadDetail.channelName || selectedThreadDetail.channelId}</Badge>
            {#if selectedThreadDetail.sessionId}
              <Badge variant="outline">session: {selectedThreadDetail.sessionId}</Badge>
            {/if}
            {#if selectedThreadDetail.workingDirectory}
              <Badge variant="outline">cwd: {selectedThreadDetail.workingDirectory}</Badge>
            {/if}
            {#if selectedThreadDetail.branchName}
              <Badge variant="outline">branch: {selectedThreadDetail.branchName}</Badge>
            {/if}
          </div>

          <div class="space-y-3">
            {#each selectedThreadDetail.details as detail}
              <div class="rounded-md border p-3">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">#{detail.seq}</Badge>
                  <Badge variant="outline">{getDetailKindLabel(detail.kind)}</Badge>
                  <Badge variant={getDetailStatusVariant(detail.status)}>{detail.status}</Badge>
                  {#if detail.isQuestion}
                    <Badge variant="outline">is_question</Badge>
                  {/if}
                  {#if detail.questionSourceId}
                    <Badge variant="outline">question_source_id: {detail.questionSourceId}</Badge>
                  {/if}
                  <span class="text-xs text-[hsl(var(--muted-foreground))]">
                    {formatTimestamp(detail.startTime)}
                    {" → "}
                    {detail.endTime ? formatTimestamp(detail.endTime) : t("(in progress)", "(进行中)")}
                    {" · "}
                    {formatDuration(detail.startTime, detail.endTime)}
                  </span>
                </div>
                {#if detail.errorText}
                  <p class="mb-2 text-xs text-[hsl(var(--destructive))]">error: {detail.errorText}</p>
                {/if}
                <pre class="max-h-[280px] overflow-auto rounded-md bg-[hsl(var(--muted)/0.45)] p-3 text-xs leading-6 whitespace-pre-wrap">{getDetailBodyText(detail)}</pre>
                {#if detail.context}
                  <details class="mt-2">
                    <summary class="cursor-pointer text-xs text-[hsl(var(--muted-foreground))]">{t("detail context", "详细上下文")}</summary>
                    <pre class="mt-2 max-h-[200px] overflow-auto rounded-md bg-[hsl(var(--muted)/0.3)] p-2 text-xs leading-6 whitespace-pre-wrap">{formatContext(detail.context)}</pre>
                  </details>
                {/if}
              </div>
            {/each}
          </div>

          {#if selectedThreadDetail.context}
            <div class="mt-4 space-y-2">
              <p class="text-sm font-medium">{t("Thread Context", "会话上下文")}</p>
              <pre class="max-h-[280px] overflow-auto rounded-md bg-[hsl(var(--muted)/0.45)] p-3 text-xs leading-6 whitespace-pre-wrap">{formatContext(selectedThreadDetail.context)}</pre>
            </div>
          {/if}
        {:else if !isDetailLoading}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("Select a thread to inspect it.", "选择一条会话查看详情。")}</p>
        {/if}
      </div>
    {/if}
  </div>

  {#if statusMessage}
    <p class="mt-4 text-sm text-[hsl(var(--muted-foreground))]">{statusMessage}</p>
  {/if}
</Card>
