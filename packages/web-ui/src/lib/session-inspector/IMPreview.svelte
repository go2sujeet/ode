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

  const state = $derived(({
    ...buildSessionMessageState(events, {
      endIndex: selectedEventIndex,
      workingDirectory,
    }),
    currentStatus: "Starting",
    currentStep: undefined,
  }) satisfies PreviewState);
</script>

<div class="im-preview">
  <div class="header">
    <h3>Message preview</h3>
    <div class="event-number">Event {selectedEventIndex + 1} of {events.length}</div>
  </div>

  <div class="preview-content">
    {#if selectedEventIndex >= 0}
      <SlackMessage {state} {workingDirectory} {provider} />
    {:else}
      <div class="empty">Select an event to see the message state</div>
    {/if}
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
  }

  .empty {
    text-align: center;
    color: var(--ink-soft);
    padding: 2rem;
  }
</style>
