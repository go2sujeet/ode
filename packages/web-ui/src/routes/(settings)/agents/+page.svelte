<script lang="ts">
  import { onMount } from "svelte";
  import { Bot } from "lucide-svelte";
  import { Badge, Button, Card } from "$lib/components/ui";
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

  function getAgentModels(agent: AgentWithModels): string[] {
    const agents = $localSettingStore.config.agents as Record<string, { models?: string[] }>;
    const models = agents[agent]?.models;
    return Array.isArray(models) ? models : [];
  }

  const isBusy = $derived($localSettingStore.isCheckingCli || $localSettingStore.isLoading || $localSettingStore.isSaving);

  onMount(() => {
    void localSettingStore.checkAgents();
  });
</script>

<Card className="p-5">
  <div class="mb-4 flex items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <Bot class="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
      <h2 class="text-lg font-semibold">Agent CLI Status</h2>
    </div>
    <Button
      variant="outline"
      on:click={() => void localSettingStore.checkAgents()}
      disabled={isBusy}
    >
      {$localSettingStore.isCheckingCli ? "Syncing..." : "Sync"}
    </Button>
  </div>

  <div class="grid gap-2">
    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Claude CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.claude ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.claude ? "Installed" : "Not found"}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.claude}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.claude} target="_blank" rel="noreferrer">Official docs</a>
        {/if}
      {/if}
    </div>

    <div class="rounded-lg border p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <strong class="text-sm">Codex CLI</strong>
        {#if $localSettingStore.cliCheckResult}
          <Badge variant={$localSettingStore.cliCheckResult.codex ? "secondary" : "destructive"}>
            {$localSettingStore.cliCheckResult.codex ? "Installed" : "Not found"}
          </Badge>
          {#if !$localSettingStore.cliCheckResult.codex}
            <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.codex} target="_blank" rel="noreferrer">Official docs</a>
          {/if}
        {/if}
      </div>
      <div class="flex flex-wrap gap-1">
        {#if getAgentModels("codex").length === 0}
          <Badge variant="outline">No models configured</Badge>
        {:else}
          {#each getAgentModels("codex") as model}
            <Badge variant="outline">{model}</Badge>
          {/each}
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Kimi CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.kimi ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.kimi ? "Installed" : "Not found"}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.kimi}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.kimi} target="_blank" rel="noreferrer">Official docs</a>
        {/if}
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Kiro CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.kiro ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.kiro ? "Installed" : "Not found"}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.kiro}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.kiro} target="_blank" rel="noreferrer">Official docs</a>
        {/if}
      {/if}
    </div>

    <div class="rounded-lg border p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <strong class="text-sm">Kilo CLI</strong>
        {#if $localSettingStore.cliCheckResult}
          <Badge variant={$localSettingStore.cliCheckResult.kilo ? "secondary" : "destructive"}>
            {$localSettingStore.cliCheckResult.kilo ? "Installed" : "Not found"}
          </Badge>
          {#if !$localSettingStore.cliCheckResult.kilo}
            <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.kilo} target="_blank" rel="noreferrer">Official docs</a>
          {/if}
        {/if}
      </div>
      <div class="flex flex-wrap gap-1">
        {#if getAgentModels("kilo").length === 0}
          <Badge variant="outline">No models configured</Badge>
        {:else}
          {#each getAgentModels("kilo") as model}
            <Badge variant="outline">{model}</Badge>
          {/each}
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Qwen CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.qwen ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.qwen ? "Installed" : "Not found"}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.qwen}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.qwen} target="_blank" rel="noreferrer">Official docs</a>
        {/if}
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Goose CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.goose ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.goose ? "Installed" : "Not found"}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.goose}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.goose} target="_blank" rel="noreferrer">Official docs</a>
        {/if}
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Gemini CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.gemini ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.gemini ? "Installed" : "Not found"}
        </Badge>
        {#if !$localSettingStore.cliCheckResult.gemini}
          <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.gemini} target="_blank" rel="noreferrer">Official docs</a>
        {/if}
      {/if}
    </div>

    <div class="rounded-lg border p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <strong class="text-sm">OpenCode CLI</strong>
        {#if $localSettingStore.cliCheckResult}
          <Badge variant={$localSettingStore.cliCheckResult.opencode ? "secondary" : "destructive"}>
            {$localSettingStore.cliCheckResult.opencode ? "Installed" : "Not found"}
          </Badge>
          {#if !$localSettingStore.cliCheckResult.opencode}
            <a class="text-xs text-[hsl(var(--primary))] underline" href={AGENT_DOCS.opencode} target="_blank" rel="noreferrer">Official docs</a>
          {/if}
        {/if}
      </div>
      <div class="flex flex-wrap gap-1">
        {#if getAgentModels("opencode").length === 0}
          <Badge variant="outline">No models configured</Badge>
        {:else}
          {#each getAgentModels("opencode") as model}
            <Badge variant="outline">{model}</Badge>
          {/each}
        {/if}
      </div>
    </div>
  </div>

  {#if $localSettingStore.agentMessage}
    <p class="mt-4 text-sm text-[hsl(var(--muted-foreground))]">{$localSettingStore.agentMessage}</p>
  {/if}
</Card>
