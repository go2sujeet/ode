<script lang="ts">
  import SlackMessage from "./SlackMessage.svelte";
  import type { AgentStatusProvider } from "../../../../utils/status";
  import { buildSessionMessageState, type SessionMessageState } from "@/utils/session-inspector";

  let {
    events,
    selectedEventIndex,
    workingDirectory,
    provider = "opencode",
  }: {
    events: Array<{
      timestamp: number;
      type: string;
      data: Record<string, unknown>;
    }>;
    selectedEventIndex: number;
    workingDirectory: string;
    provider?: AgentStatusProvider;
  } = $props();

  type PreviewState = SessionMessageState & {
    currentStatus: string;
    currentStep?: string;
  };

  type PreviewPlatform = "slack" | "discord" | "lark";

  let previewPlatform = $state<PreviewPlatform>("slack");

  const state = $derived(({
    ...buildSessionMessageState(events, {
      endIndex: selectedEventIndex,
      workingDirectory,
      provider,
    }),
    currentStatus: "Starting",
    currentStep: undefined,
  }) satisfies PreviewState);

  const finalState = $derived(({
    ...buildSessionMessageState(events, {
      workingDirectory,
      provider,
    }),
    currentStatus: "Completed",
    currentStep: undefined,
  }) satisfies PreviewState);

  const finalResultText = $derived(finalState.currentText?.trim() || "");
</script>

<div class="im-preview">
  <div class="header">
    <h3>Message preview</h3>
    <div class="header-right">
      <label class="platform-select">
        <span>Format</span>
        <select bind:value={previewPlatform}>
          <option value="slack">Slack</option>
          <option value="discord">Discord</option>
          <option value="lark">Lark</option>
        </select>
      </label>
      <div class="event-number">Event {selectedEventIndex + 1} of {events.length}</div>
    </div>
  </div>

  <div class="preview-content">
    {#if selectedEventIndex >= 0}
      <SlackMessage {state} {workingDirectory} {provider} platform={previewPlatform} />
    {:else}
      <div class="empty">Select an event to see the message state</div>
    {/if}

    <section class="final-section">
      <h4>Final status message</h4>
      <SlackMessage state={finalState} {workingDirectory} {provider} platform={previewPlatform} />
      <h4>Result message</h4>
      {#if finalResultText}
        <SlackMessage text={finalResultText} {workingDirectory} {provider} platform={previewPlatform} />
      {:else}
        <div class="empty small">No final result text captured.</div>
      {/if}
    </section>
  </div>
</div>

<style>
  .im-preview {
    height: 100%;
    overflow-y: auto;
  }

  .header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    background: var(--card);
    z-index: 10;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .platform-select {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }

  .platform-select select {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.2rem 0.4rem;
    background: var(--bg);
    color: var(--ink);
  }

  h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .event-number {
    color: var(--ink-soft);
    font-size: 0.85rem;
  }

  .preview-content {
    padding: 1rem 1.25rem 2rem;
    display: grid;
    gap: 1rem;
  }

  .empty {
    text-align: center;
    color: var(--ink-soft);
    padding: 2rem;
  }

  .empty.small {
    padding: 1rem;
    border: 1px dashed var(--line);
    border-radius: 10px;
    background: var(--bg-soft);
  }

  .final-section {
    display: grid;
    gap: 0.65rem;
    margin-top: 0.5rem;
  }

  .final-section h4 {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
</style>
