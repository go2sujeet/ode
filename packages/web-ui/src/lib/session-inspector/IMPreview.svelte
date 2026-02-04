<script lang="ts">
  import SlackMessage from "./SlackMessage.svelte";

  export let events: Array<{
    timestamp: number;
    type: string;
    data: Record<string, unknown>;
  }>;
  export let selectedEventIndex: number;
  export let workingDirectory: string;

  interface MessageState {
    currentStatus: string;
    currentStep?: string;
    currentText: string;
    tools: Array<{
      id: string;
      name: string;
      status: string;
      title?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
      metadata?: Record<string, unknown>;
    }>;
    todos: Array<{
      content: string;
      status: string;
    }>;
    startedAt: number;
  }

  let state: MessageState = {
    currentStatus: "Starting",
    currentText: "",
    tools: [],
    todos: [],
    startedAt: Date.now(),
  };

  $: {
    const reconstructedState: MessageState = {
      currentStatus: "Starting",
      currentText: "",
      tools: [],
      todos: [],
      startedAt: events[0]?.timestamp || Date.now(),
    };

    const relevantEvents = events.slice(0, selectedEventIndex + 1);

    for (const event of relevantEvents) {
      const eventData = event.data as any;
      const type = event.type;

      if (type === "message.part.updated") {
        const part = eventData.properties?.part as any;
        if (!part) continue;

        if (part.type === "tool") {
          const toolState = part.state || {};
          const existingIdx = reconstructedState.tools.findIndex((t) => t.id === part.id);
          const toolInfo = {
            id: part.id,
            name: part.tool || "Unknown tool",
            status: toolState.status || "pending",
            title: toolState.title,
            input: toolState.input,
            output: toolState.output,
            error: toolState.error,
            metadata: toolState.metadata,
          };

          if (existingIdx >= 0) {
            reconstructedState.tools[existingIdx] = toolInfo;
          } else {
            reconstructedState.tools.push(toolInfo);
          }

          if (toolState.status === "running") {
            const label = formatToolLabel(toolInfo);
            reconstructedState.currentStatus = label ? `Running: ${label}` : "Running";
          }
        } else if (part.type === "text" && part.text) {
          reconstructedState.currentText = part.text;
          reconstructedState.currentStatus = "Writing response";
        } else if (part.type === "step-start") {
          reconstructedState.currentStep = part.metadata?.title || "Thinking";
          reconstructedState.currentStatus = "Thinking";
        } else if (part.type === "step-finish") {
          reconstructedState.currentStep = undefined;
        } else if (part.type === "reasoning") {
          reconstructedState.currentStatus = "Reasoning";
          reconstructedState.currentStep = "Thinking deeply...";
        }
      } else if (type === "todo.updated") {
        const todos = (eventData.properties?.todos as any[]) || [];
        reconstructedState.todos = todos.map((t: any) => ({
          content: t.content || t.text || "",
          status: t.status || "pending",
        }));
      } else if (type === "session.status") {
        const status = eventData.properties?.status as any;
        if (status?.type === "busy") {
          reconstructedState.currentStatus = "Working";
        } else if (status?.type === "retry") {
          reconstructedState.currentStatus = "Retrying...";
        }
      }
    }

    state = reconstructedState;
  }

  function formatToolLabel(tool: any): string | null {
    const title = tool.title?.trim() ?? "";
    const name = tool.name?.trim() ?? "";
    if (!title && !name) return null;

    const normalizedTitle = title ? trimToolPath(title) : "";
    const toolName = name.toLowerCase();

    const SEARCH_TOOL_NAMES = new Set(["glob", "grep", "rg", "ripgrep", "search"]);
    const EDIT_TOOL_NAMES = new Set(["edit", "write"]);
    const READ_TOOL_NAMES = new Set(["read"]);

    if (READ_TOOL_NAMES.has(toolName)) return null;

    if (SEARCH_TOOL_NAMES.has(toolName)) {
      return "Searching files";
    }

    if (EDIT_TOOL_NAMES.has(toolName)) {
      if (!normalizedTitle) return "Editing files";
      return `Editing ${normalizedTitle}`;
    }

    return normalizedTitle || name;
  }

  function trimToolPath(label: string): string {
    let trimmed = label.trim();
    if (!trimmed) return trimmed;

    if (workingDirectory && trimmed.startsWith(`${workingDirectory}/`)) {
      trimmed = trimmed.slice(workingDirectory.length + 1);
    }

    trimmed = trimmed.replace(/(^|\/)\.worktrees\/[^/]+\//, "");
    trimmed = trimmed.replace(/^\//, "");
    return trimmed;
  }
</script>

<div class="im-preview">
  <div class="header">
    <h3>Message preview</h3>
    <div class="event-number">Event {selectedEventIndex + 1} of {events.length}</div>
  </div>

  <div class="preview-content">
    {#if selectedEventIndex >= 0}
      <SlackMessage {state} {workingDirectory} />
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
