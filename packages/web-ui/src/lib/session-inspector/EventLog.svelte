<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  let {
    events,
    selectedEventIndex,
    onSelect,
  }: {
    events: Array<{
      timestamp: number;
      type: string;
      data: Record<string, unknown>;
    }>;
    selectedEventIndex: number;
    onSelect: (index: number) => void;
  } = $props();

  let containerEl: HTMLElement;
  let observer: IntersectionObserver | null = null;
  let visibleIndices = new Set<number>();
  let manualSelectTimeout: number | null = null;
  let isManualSelect = false;

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  }

  function getEventIcon(type: string): string {
    switch (type) {
      case "message.part.updated":
        return "📝";
      case "todo.updated":
        return "✅";
      case "session.status":
        return "⚡";
      case "session.error":
        return "❌";
      default:
        return "•";
    }
  }

  function getEventSummary(event: any): string {
    const type = event.type;
    const props = event.data?.properties;

    if (type === "message.part.updated") {
      const part = props?.part;
      if (part?.type === "tool") {
        const toolName = part.tool || "tool";
        const status = part.state?.status || "unknown";
        return `Tool: ${toolName} (${status})`;
      }
      if (part?.type === "text") {
        const preview = (part.text || "").substring(0, 50);
        return `Text: ${preview}${(part.text?.length || 0) > 50 ? "..." : ""}`;
      }
      if (part?.type === "reasoning") {
        return "Reasoning";
      }
      if (part?.type === "step-start") {
        return `Step: ${part.metadata?.title || "Started"}`;
      }
      if (part?.type === "step-finish") {
        return "Step: Finished";
      }
      return `Part: ${part?.type || "unknown"}`;
    }

    if (type === "todo.updated") {
      const todos = props?.todos || [];
      return `Todos updated (${todos.length} items)`;
    }

    if (type === "session.status") {
      const status = props?.status?.type || "unknown";
      return `Status: ${status}`;
    }

    if (type === "session.error") {
      const error = props?.error || "Unknown error";
      return `Error: ${typeof error === "string" ? error : JSON.stringify(error)}`;
    }

    return type;
  }

  function stripRedundantFields(data: any): any {
    if (!data) return data;
    const stripped = { ...data };

    if (stripped.properties?.info) {
      stripped.properties = {
        ...stripped.properties,
        info: { ...stripped.properties.info },
      };
      delete stripped.properties.info.sessionID;
    }

    return stripped;
  }

  function handleManualSelect(index: number) {
    isManualSelect = true;
    if (manualSelectTimeout) clearTimeout(manualSelectTimeout);
    manualSelectTimeout = window.setTimeout(() => {
      isManualSelect = false;
    }, 300);
    onSelect(index);
  }

  function updateSelectionFromScroll() {
    if (isManualSelect || visibleIndices.size === 0) return;
    const firstVisible = Math.min(...visibleIndices);
    if (firstVisible !== selectedEventIndex) {
      onSelect(firstVisible);
    }
  }

  onMount(() => {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = parseInt((entry.target as HTMLElement).dataset.eventIndex || "-1", 10);
          if (index < 0) continue;
          if (entry.isIntersecting) {
            visibleIndices.add(index);
          } else {
            visibleIndices.delete(index);
          }
        }
        updateSelectionFromScroll();
      },
      {
        root: containerEl,
        rootMargin: "-60px 0px 0px 0px",
        threshold: 0.5,
      },
    );

    const eventElements = containerEl?.querySelectorAll("[data-event-index]");
    eventElements?.forEach((el) => observer?.observe(el));
  });

  onDestroy(() => {
    observer?.disconnect();
    if (manualSelectTimeout) clearTimeout(manualSelectTimeout);
  });

  $effect(() => {
    if (!observer || !containerEl || !events.length) return;
    observer.disconnect();
    visibleIndices.clear();
    setTimeout(() => {
      const eventElements = containerEl?.querySelectorAll("[data-event-index]");
      eventElements?.forEach((el) => observer?.observe(el));
    }, 50);
  });
</script>

<div class="event-log" bind:this={containerEl}>
  <div class="header">
    <h3>Event log</h3>
    <div class="count">{events.length} events</div>
  </div>

  <div class="events">
    {#each events as event, i}
      <div
        class="event"
        class:selected={i === selectedEventIndex}
        data-event-index={i}
        onclick={() => handleManualSelect(i)}
        onkeydown={(e) => e.key === "Enter" && handleManualSelect(i)}
        role="button"
        tabindex="0"
      >
        <div class="event-header">
          <span class="icon">{getEventIcon(event.type)}</span>
          <span class="time">{formatTimestamp(event.timestamp)}</span>
        </div>
        <div class="event-summary">{getEventSummary(event)}</div>
        <div class="event-type">{event.type}</div>
        <pre class="event-json">{JSON.stringify(stripRedundantFields(event.data), null, 2)}</pre>
      </div>
    {/each}
  </div>
</div>

<style>
  .event-log {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
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

  .count {
    color: var(--ink-soft);
    font-size: 0.85rem;
  }

  .events {
    padding: 0.75rem 1rem 1.5rem;
    display: grid;
    gap: 0.75rem;
    min-height: 0;
  }

  .event {
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 0.75rem 0.9rem;
    cursor: pointer;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }

  .event:hover {
    border-color: var(--accent-muted);
    transform: translateY(-1px);
  }

  .event.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .event-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }

  .time {
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--ink-soft);
  }

  .event-summary {
    font-size: 0.9rem;
    color: var(--ink);
    margin-bottom: 0.2rem;
  }

  .event-type {
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.7rem;
    color: var(--ink-soft);
  }

  .event-json {
    margin: 0.6rem 0 0 0;
    padding: 0.6rem;
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    border: 1px solid var(--line);
    border-radius: 10px;
    font-family: "SF Mono", "Space Mono", ui-monospace, monospace;
    font-size: 0.7rem;
    color: var(--ink-soft);
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    max-height: 260px;
  }
</style>
