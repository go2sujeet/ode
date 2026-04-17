<script lang="ts">
  import { onMount } from "svelte";
  import { Bot } from "lucide-svelte";
  import { Badge, Button, Card } from "$lib/components/ui";
  import { locale } from "$lib/i18n";
  import { localSettingStore } from "$lib/local-setting/store";

  type AgentWithModels = "opencode" | "codex" | "kilo";
  type AgentStatusKey = "opencode" | "claude" | "codex" | "kimi" | "kiro" | "kilo" | "qwen" | "goose" | "gemini";

  const AGENT_DOCS: Record<AgentStatusKey, string> = {
    opencode: "https://opencode.ai",
    claude: "https://docs.anthropic.com/en/docs/claude-code/overview",
    codex: "https://github.com/openai/codex",
    kimi: "https://www.moonshot.ai/kimi-code",
    kiro: "https://kiro.dev",
    kilo: "https://github.com/Kilo-Org/kilo",
    qwen: "https://github.com/QwenLM/qwen-code",
    goose: "https://block.github.io/goose/",
    gemini: "https://github.com/google-gemini/gemini-cli",
  };

  const isBusy = $derived($localSettingStore.isCheckingCli || $localSettingStore.isLoading || $localSettingStore.isSaving);

  function getAgentModels(agent: AgentWithModels): string[] {
    const agents = $localSettingStore.config.agents as Record<string, { models?: string[] }>;
    const models = agents[agent]?.models;
    return Array.isArray(models) ? models : [];
  }

  function t(en: string, zh: string): string {
    return $locale === "zh-CN" ? zh : en;
  }

  onMount(() => {
    void localSettingStore.checkAgents();
  });
</script>

<Card className="p-5">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <Bot class="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
      <div>
        <h2 class="text-lg font-semibold">{t("Agent CLI Status", "代理 CLI 状态")}</h2>
        <p class="text-xs text-[hsl(var(--muted-foreground))]">{t("Installed coding tool CLIs and configured models", "已安装的编码工具 CLI 与已配置模型")}</p>
      </div>
    </div>
    <Button
      variant="outline"
      on:click={() => void localSettingStore.checkAgents()}
      disabled={isBusy}
    >
      {$localSettingStore.isCheckingCli ? t("Syncing...", "同步中...") : t("Sync", "同步")}
    </Button>
  </div>

  <div class="grid gap-2">
    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Claude Code</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.claude ? "success" : "secondary"}>
          {$localSettingStore.cliCheckResult.claude ? t("Installed", "已安装") : t("Not found", "未安装")}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.claude}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.claude} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
        {/if}
      {/if}
    </div>

    <div class="rounded-lg border p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <strong class="text-sm">Codex CLI</strong>
        {#if $localSettingStore.cliCheckResult}
          <Badge variant={$localSettingStore.cliCheckResult.codex ? "success" : "secondary"}>
            {$localSettingStore.cliCheckResult.codex ? t("Installed", "已安装") : t("Not found", "未安装")}
          </Badge>
          {#if !$localSettingStore.cliCheckResult.codex}
            <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.codex} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
          {/if}
        {/if}
      </div>
      <div class="flex flex-wrap gap-1">
        {#if getAgentModels("codex").length > 0}
          {#each getAgentModels("codex") as model}
            <Badge variant="outline">{model}</Badge>
          {/each}
        {:else if $localSettingStore.cliCheckResult?.codex}
          <Badge variant="outline">{t("No models configured", "未配置模型")}</Badge>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Kimi CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.kimi ? "success" : "secondary"}>
          {$localSettingStore.cliCheckResult.kimi ? t("Installed", "已安装") : t("Not found", "未安装")}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.kimi}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.kimi} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
        {/if}
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Kiro CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.kiro ? "success" : "secondary"}>
          {$localSettingStore.cliCheckResult.kiro ? t("Installed", "已安装") : t("Not found", "未安装")}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.kiro}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.kiro} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
        {/if}
      {/if}
    </div>

    <div class="rounded-lg border p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <strong class="text-sm">Kilo CLI</strong>
        {#if $localSettingStore.cliCheckResult}
          <Badge variant={$localSettingStore.cliCheckResult.kilo ? "success" : "secondary"}>
            {$localSettingStore.cliCheckResult.kilo ? t("Installed", "已安装") : t("Not found", "未安装")}
          </Badge>
          {#if !$localSettingStore.cliCheckResult.kilo}
            <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.kilo} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
          {/if}
        {/if}
      </div>
      <div class="flex flex-wrap gap-1">
        {#if getAgentModels("kilo").length > 0}
          {#each getAgentModels("kilo") as model}
            <Badge variant="outline">{model}</Badge>
          {/each}
        {:else if $localSettingStore.cliCheckResult?.kilo}
          <Badge variant="outline">{t("No models configured", "未配置模型")}</Badge>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Qwen CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.qwen ? "success" : "secondary"}>
          {$localSettingStore.cliCheckResult.qwen ? t("Installed", "已安装") : t("Not found", "未安装")}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.qwen}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.qwen} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
        {/if}
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Goose CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.goose ? "success" : "secondary"}>
          {$localSettingStore.cliCheckResult.goose ? t("Installed", "已安装") : t("Not found", "未安装")}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.goose}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.goose} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
        {/if}
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Gemini CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.gemini ? "success" : "secondary"}>
          {$localSettingStore.cliCheckResult.gemini ? t("Installed", "已安装") : t("Not found", "未安装")}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.gemini}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.gemini} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
        {/if}
      {/if}
    </div>

    <div class="rounded-lg border p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <strong class="text-sm">OpenCode CLI</strong>
        {#if $localSettingStore.cliCheckResult}
          <Badge variant={$localSettingStore.cliCheckResult.opencode ? "success" : "secondary"}>
            {$localSettingStore.cliCheckResult.opencode ? t("Installed", "已安装") : t("Not found", "未安装")}
          </Badge>
          {#if !$localSettingStore.cliCheckResult.opencode}
            <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.opencode} target="_blank" rel="noreferrer">{t("Install docs", "安装文档")}</a>
          {/if}
        {/if}
      </div>
      <div class="flex flex-wrap gap-1">
        {#if getAgentModels("opencode").length > 0}
          {#each getAgentModels("opencode") as model}
            <Badge variant="outline">{model}</Badge>
          {/each}
        {:else if $localSettingStore.cliCheckResult?.opencode}
          <Badge variant="outline">{t("No models configured", "未配置模型")}</Badge>
        {/if}
      </div>
    </div>
  </div>

  {#if $localSettingStore.agentMessage}
    <p class="mt-4 text-sm text-[hsl(var(--muted-foreground))]">{$localSettingStore.agentMessage}</p>
  {/if}
</Card>
