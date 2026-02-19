<script lang="ts">
  import { Bot } from "lucide-svelte";
  import { Badge, Button, Card } from "$lib/components/ui";
  import { localSettingStore } from "$lib/local-setting/store";
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
      disabled={$localSettingStore.isCheckingCli || $localSettingStore.isLoading || $localSettingStore.isSaving}
    >
      {$localSettingStore.isCheckingCli ? "Checking..." : "Check"}
    </Button>
  </div>

  <div class="grid gap-2">
    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Claude CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.claude ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.claude ? "Installed" : "Not found"}
        </Badge>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Codex CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.codex ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.codex ? "Installed" : "Not found"}
        </Badge>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Kimi CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.kimi ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.kimi ? "Installed" : "Not found"}
        </Badge>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Kiro CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.kiro ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.kiro ? "Installed" : "Not found"}
        </Badge>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Kilo CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.kilo ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.kilo ? "Installed" : "Not found"}
        </Badge>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Qwen CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.qwen ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.qwen ? "Installed" : "Not found"}
        </Badge>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 rounded-lg border p-3">
      <strong class="text-sm">Goose CLI</strong>
      {#if $localSettingStore.cliCheckResult}
        <Badge variant={$localSettingStore.cliCheckResult.goose ? "secondary" : "destructive"}>
          {$localSettingStore.cliCheckResult.goose ? "Installed" : "Not found"}
        </Badge>
      {/if}
    </div>

    <div class="rounded-lg border p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <strong class="text-sm">OpenCode CLI</strong>
        {#if $localSettingStore.cliCheckResult}
          <Badge variant={$localSettingStore.cliCheckResult.opencode ? "secondary" : "destructive"}>
            {$localSettingStore.cliCheckResult.opencode ? "Installed" : "Not found"}
          </Badge>
        {/if}
      </div>
      <div class="flex flex-wrap gap-1">
        {#if $localSettingStore.config.agents.opencode.models.length === 0}
          <Badge variant="outline">No models configured</Badge>
        {:else}
          {#each $localSettingStore.config.agents.opencode.models as model}
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
