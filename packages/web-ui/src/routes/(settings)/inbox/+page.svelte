<script lang="ts">
  import { onMount } from "svelte";
  import { Inbox, RefreshCw } from "lucide-svelte";
  import { AGENT_PROVIDER_LABELS, type AgentProviderId } from "@/shared/agent-provider";
  import { Badge, Button, Card } from "$lib/components/ui";
  import { locale } from "$lib/i18n";

  type InboxStatus = "pending" | "completed" | "failed";

  type InboxRecordSummary = {
    id: string;
    status: InboxStatus;
    platform: "slack" | "discord" | "lark";
    workspaceId: string | null;
    workspaceName: string | null;
    channelId: string;
    channelName: string | null;
    rawChannelId: string | null;
    threadId: string;
    replyThreadId: string;
    sessionId: string | null;
    userId: string | null;
    messageId: string | null;
    providerId: string | null;
    model: string | null;
    workingDirectory: string | null;
    promptSummary: string;
    resultSummary: string | null;
    promptLength: number;
    resultLength: number;
    errorText: string | null;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
  };

  type InboxRecordDetail = InboxRecordSummary & {
    promptText: string;
    resultText: string | null;
    context: Record<string, unknown> | null;
  };

  type InboxPage = {
    items: InboxRecordSummary[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };

  let inboxPage = $state<InboxPage>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  });
  let isInboxLoading = $state(false);
  let inboxMessage = $state("");
  let selectedInboxId = $state<string | null>(null);
  let selectedInboxDetail = $state<InboxRecordDetail | null>(null);
  let isInboxDetailLoading = $state(false);

  function t(en: string, zh: string): string {
    return $locale === "zh-CN" ? zh : en;
  }

  function formatTimestamp(timestamp: number | null | undefined): string {
    if (!timestamp || !Number.isFinite(timestamp)) return t("Unknown time", "未知时间");
    return new Date(timestamp).toLocaleString($locale === "zh-CN" ? "zh-CN" : "en-US");
  }

  function getProviderLabel(providerId: string | null): string {
    if (!providerId) return t("Unknown provider", "未知 Provider");
    return AGENT_PROVIDER_LABELS[providerId as AgentProviderId] ?? providerId;
  }

  function getInboxStatusVariant(status: InboxStatus): "secondary" | "success" | "destructive" {
    if (status === "completed") return "success";
    if (status === "failed") return "destructive";
    return "secondary";
  }

  function formatContext(context: Record<string, unknown> | null): string {
    if (!context) return "";
    return JSON.stringify(context, null, 2);
  }

  function getInboxLocation(record: InboxRecordSummary): string {
    const workspace = record.workspaceName || record.workspaceId || t("Unknown workspace", "未知工作区");
    const channel = record.channelName || record.channelId;
    return `${workspace} / ${channel}`;
  }

  async function loadInbox(page = inboxPage.page): Promise<void> {
    isInboxLoading = true;
    inboxMessage = "";
    try {
      const response = await fetch(`/api/inbox?page=${page}&pageSize=${inboxPage.pageSize}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: InboxPage;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || "Failed to load inbox");
      }
      inboxPage = payload.result;
      if (selectedInboxId && !payload.result.items.some((item) => item.id === selectedInboxId)) {
        selectedInboxId = null;
        selectedInboxDetail = null;
      }
    } catch (error) {
      inboxMessage = `Inbox load failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      isInboxLoading = false;
    }
  }

  async function openInboxRecord(recordId: string): Promise<void> {
    if (selectedInboxId === recordId && selectedInboxDetail) {
      selectedInboxId = null;
      selectedInboxDetail = null;
      return;
    }

    selectedInboxId = recordId;
    isInboxDetailLoading = true;
    inboxMessage = "";
    try {
      const response = await fetch(`/api/inbox/${encodeURIComponent(recordId)}`);
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        result?: InboxRecordDetail;
      };
      if (!response.ok || !payload.ok || !payload.result) {
        throw new Error(payload.error || "Failed to load inbox detail");
      }
      if (selectedInboxId === recordId) {
        selectedInboxDetail = payload.result;
      }
    } catch (error) {
      inboxMessage = `Inbox detail failed: ${error instanceof Error ? error.message : String(error)}`;
      if (selectedInboxId === recordId) {
        selectedInboxDetail = null;
      }
    } finally {
      isInboxDetailLoading = false;
    }
  }

  onMount(() => {
    void loadInbox(1);
  });
</script>

<Card className="p-5">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-2">
      <Inbox class="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
      <div>
        <h2 class="text-lg font-semibold">{t("Inbox", "收件箱")}</h2>
        <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Raw user messages and final agent results stored in SQLite", "存放在 SQLite 里的用户原始消息与 Agent 最终结果")}</p>
      </div>
    </div>

    <Button
      variant="outline"
      on:click={() => void loadInbox(inboxPage.page)}
      disabled={isInboxLoading}
    >
      <RefreshCw class="h-4 w-4" />
      {isInboxLoading ? t("Loading...", "加载中...") : t("Refresh", "刷新")}
    </Button>
  </div>

  <div class="space-y-4">
    <div class="rounded-lg border p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-sm font-medium">{t("Message Feed", "消息列表")}</p>
          <p class="text-xs text-[hsl(var(--muted-foreground))]">
            {t("Default view shows summaries only. Open a record for the full prompt and final result.", "默认只展示摘要，点开记录才会加载完整 prompt 和最终 result。")}
          </p>
        </div>
        <Badge variant="outline">{t("SQLite-backed", "SQLite 持久化")}</Badge>
      </div>

      {#if isInboxLoading && inboxPage.items.length === 0}
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("Loading inbox...", "正在加载收件箱...")}</p>
      {:else if inboxPage.items.length === 0}
        <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("No inbox records yet.", "暂时还没有收件箱记录。")}</p>
      {:else}
        <div class="space-y-3">
          {#each inboxPage.items as record}
            <div class="rounded-lg border p-4">
              <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div class="space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant={getInboxStatusVariant(record.status)}>
                      {record.status === "completed"
                        ? t("Completed", "已完成")
                        : record.status === "failed"
                          ? t("Failed", "失败")
                          : t("Pending", "处理中")}
                    </Badge>
                    <Badge variant="outline">{getProviderLabel(record.providerId)}</Badge>
                    <Badge variant="outline">{record.platform}</Badge>
                  </div>
                  <p class="text-sm font-medium">{getInboxLocation(record)}</p>
                  <p class="text-xs text-[hsl(var(--muted-foreground))]">
                    {t("Model", "模型")}: {record.model || t("Default", "默认")}
                    {" · "}
                    {t("Created", "创建于")}: {formatTimestamp(record.createdAt)}
                  </p>
                </div>

                <Button
                  variant="outline"
                  className="shrink-0"
                  on:click={() => void openInboxRecord(record.id)}
                >
                  {selectedInboxId === record.id && selectedInboxDetail
                    ? t("Hide Detail", "收起详情")
                    : t("View Detail", "查看详情")}
                </Button>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-md bg-[hsl(var(--muted)/0.4)] p-3">
                  <p class="mb-1 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{t("User Message", "用户消息")}</p>
                  <p class="text-sm leading-6">{record.promptSummary}</p>
                  <p class="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{record.promptLength} chars</p>
                </div>

                <div class="rounded-md bg-[hsl(var(--muted)/0.4)] p-3">
                  <p class="mb-1 text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{t("Result Message", "结果消息")}</p>
                  <p class="text-sm leading-6">
                    {record.resultSummary || record.errorText || t("Waiting for final result.", "等待最终结果中。")}
                  </p>
                  <p class="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                    {record.resultLength > 0 ? `${record.resultLength} chars` : t("No final result yet", "暂无最终结果")}
                  </p>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p class="text-xs text-[hsl(var(--muted-foreground))]">
          {t("Total", "总计")} {inboxPage.total} {t("records", "条记录")}
          {" · "}
          {t("Page", "页码")} {inboxPage.page}/{inboxPage.totalPages}
        </p>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={isInboxLoading || inboxPage.page <= 1}
            on:click={() => void loadInbox(inboxPage.page - 1)}
          >
            {t("Previous", "上一页")}
          </Button>
          <Button
            variant="outline"
            disabled={isInboxLoading || inboxPage.page >= inboxPage.totalPages}
            on:click={() => void loadInbox(inboxPage.page + 1)}
          >
            {t("Next", "下一页")}
          </Button>
        </div>
      </div>
    </div>

    {#if selectedInboxId}
      <div class="rounded-lg border p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <div>
            <p class="text-sm font-medium">{t("Record Detail", "记录详情")}</p>
            <p class="text-xs text-[hsl(var(--muted-foreground))]">{selectedInboxId}</p>
          </div>
          {#if isInboxDetailLoading}
            <Badge variant="outline">{t("Loading", "加载中")}</Badge>
          {/if}
        </div>

        {#if selectedInboxDetail}
          <div class="mb-4 flex flex-wrap gap-2">
            <Badge variant={getInboxStatusVariant(selectedInboxDetail.status)}>
              {selectedInboxDetail.status}
            </Badge>
            <Badge variant="outline">{getProviderLabel(selectedInboxDetail.providerId)}</Badge>
            <Badge variant="outline">{selectedInboxDetail.model || t("Default model", "默认模型")}</Badge>
            <Badge variant="outline">{selectedInboxDetail.channelName || selectedInboxDetail.channelId}</Badge>
          </div>

          <div class="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div class="space-y-2">
              <p class="text-sm font-medium">{t("Original Message", "原始消息")}</p>
              <pre class="max-h-[420px] overflow-auto rounded-md bg-[hsl(var(--muted)/0.45)] p-3 text-xs leading-6 whitespace-pre-wrap">{selectedInboxDetail.promptText}</pre>
            </div>

            <div class="space-y-2">
              <p class="text-sm font-medium">{t("Result Message", "结果消息")}</p>
              <pre class="max-h-[420px] overflow-auto rounded-md bg-[hsl(var(--muted)/0.45)] p-3 text-xs leading-6 whitespace-pre-wrap">{selectedInboxDetail.resultText || selectedInboxDetail.errorText || t("No result", "暂无结果")}</pre>
            </div>
          </div>

          <div class="mt-4 space-y-2">
            <p class="text-sm font-medium">{t("Context", "上下文")}</p>
            <pre class="max-h-[280px] overflow-auto rounded-md bg-[hsl(var(--muted)/0.45)] p-3 text-xs leading-6 whitespace-pre-wrap">{formatContext(selectedInboxDetail.context) || t("No context stored", "暂无上下文信息")}</pre>
          </div>
        {:else if !isInboxDetailLoading}
          <p class="text-sm text-[hsl(var(--muted-foreground))]">{t("Select a record to inspect it.", "选择一条记录查看详情。")}</p>
        {/if}
      </div>
    {/if}
  </div>

  {#if inboxMessage}
    <p class="mt-4 text-sm text-[hsl(var(--muted-foreground))]">{inboxMessage}</p>
  {/if}
</Card>
