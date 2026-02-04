<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import EventLog from "./EventLog.svelte";
  import IMPreview from "./IMPreview.svelte";

  export let sessionId: string;

  interface SessionEvent {
    timestamp: number;
    type: string;
    sessionId: string;
    channelId: string;
    threadId: string;
    data: Record<string, unknown>;
  }

  interface SessionMeta {
    sessionId: string;
    channelId: string;
    threadId: string;
    workingDirectory: string;
    createdAt: number;
    lastActivityAt: number;
  }

  let events: SessionEvent[] = [];
  let meta: SessionMeta | null = null;
  let loading = true;
  let error = "";
  let selectedEventIndex = -1;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let expandDeltas = false;
  let fetchInProgress = false;
  let lastExpandDeltas = false;

  function getPartId(event: SessionEvent): string | null {
    const props = (event.data?.properties || event.data) as Record<string, unknown> | undefined;
    const part = props?.part as Record<string, unknown> | undefined;
    return (part?.id as string) || null;
  }

  async function fetchEvents(incremental = true) {
    if (fetchInProgress) return;
    fetchInProgress = true;

    try {
      const params = new URLSearchParams();
      if (expandDeltas) params.set("expand", "true");

      const expandChanged = expandDeltas !== lastExpandDeltas;
      const useIncremental = incremental && !expandChanged && events.length > 0;

      if (useIncremental) {
        const lastTimestamp = events[events.length - 1].timestamp;
        params.set("since", lastTimestamp.toString());
      }

      const queryString = params.toString();
      const url = `/api/sessions/${sessionId}/events${queryString ? `?${queryString}` : ""}`;
      const response = await fetch(url);
      if (!response.ok) return;

      const payload = await response.json();
      if (!payload?.ok) return;

      const newEvents: SessionEvent[] = payload.result ?? [];

      const wasAtEnd = selectedEventIndex === events.length - 1 || events.length === 0;

      if (expandChanged || !incremental) {
        events = newEvents;
        lastExpandDeltas = expandDeltas;
      } else if (newEvents.length > 0) {
        if (expandDeltas) {
          events = [...events, ...newEvents];
        } else {
          const eventMap = new Map<string, { event: SessionEvent; index: number }>();
          events.forEach((e, i) => {
            const partId = getPartId(e);
            if (partId) eventMap.set(partId, { event: e, index: i });
          });

          const updatedEvents = [...events];
          for (const newEvent of newEvents) {
            const partId = getPartId(newEvent);
            if (partId && eventMap.has(partId)) {
              updatedEvents[eventMap.get(partId)!.index] = newEvent;
            } else {
              updatedEvents.push(newEvent);
            }
          }
          events = updatedEvents;
        }
      }

      if (wasAtEnd && events.length > 0) {
        selectedEventIndex = events.length - 1;
      }
    } catch {
      // ignore polling errors
    } finally {
      fetchInProgress = false;
    }
  }

  onMount(async () => {
    try {
      const metaResponse = await fetch(`/api/sessions/${sessionId}`);
      if (!metaResponse.ok) {
        const payload = await metaResponse.json().catch(() => null);
        throw new Error(payload?.error || "Failed to fetch session data");
      }
      const metaPayload = await metaResponse.json();
      if (!metaPayload?.ok) {
        throw new Error(metaPayload?.error || "Failed to fetch session data");
      }
      meta = metaPayload.result ?? null;

      await fetchEvents(false);
      lastExpandDeltas = expandDeltas;

      if (events.length > 0) {
        selectedEventIndex = events.length - 1;
      }

      loading = false;

      pollInterval = setInterval(() => fetchEvents(true), 5000);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
      loading = false;
    }
  });

  $: if (!loading && meta && expandDeltas !== lastExpandDeltas) {
    fetchEvents(false);
  }

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
    }
  });

  function handleEventSelect(index: number) {
    selectedEventIndex = index;
  }
</script>

<div class="session-detail">
  {#if loading}
    <div class="state">Loading session...</div>
  {:else if error}
    <div class="state error">{error}</div>
  {:else if !meta}
    <div class="state error">Session not found</div>
  {:else}
    <div class="toolbar">
      <div class="session-meta">
        <div class="session-id">{meta.sessionId}</div>
        <div class="session-sub">{meta.workingDirectory}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" bind:checked={expandDeltas} />
        <span>Expand deltas</span>
      </label>
    </div>
    <div class="split-view">
      <div class="left-panel">
        <EventLog {events} {selectedEventIndex} onSelect={handleEventSelect} />
      </div>
      <div class="right-panel">
        <IMPreview {events} {selectedEventIndex} workingDirectory={meta.workingDirectory} />
      </div>
    </div>
  {/if}
</div>

<style>
  .session-detail {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .state {
    padding: 2rem;
    text-align: center;
    color: var(--ink-soft);
  }

  .state.error {
    color: #c24f3f;
  }

  .toolbar {
    padding: 1rem 1.5rem;
    background: var(--card);
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .session-meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .session-id {
    font-family: "Space Grotesk", sans-serif;
    font-weight: 600;
  }

  .session-sub {
    color: var(--ink-soft);
    font-size: 0.85rem;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .toggle input {
    cursor: pointer;
  }

  .toggle:has(input:checked) span {
    color: var(--ink);
  }

  .split-view {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--line);
    overflow: hidden;
    min-height: 0;
  }

  .left-panel,
  .right-panel {
    background: var(--bg);
    overflow: hidden;
    min-height: 0;
  }

  .right-panel {
    position: sticky;
    top: 0;
    align-self: start;
    height: 100%;
    overflow: auto;
  }

  @media (max-width: 960px) {
    .split-view {
      grid-template-columns: 1fr;
    }
  }
</style>
