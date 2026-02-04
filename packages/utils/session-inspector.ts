export type SessionEvent = {
  timestamp: number;
  type: string;
  data: Record<string, unknown>;
};

export type SessionTokenUsage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost?: number;
};

export type SessionTool = {
  id: string;
  name: string;
  status: string;
  title?: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type SessionTodo = {
  content: string;
  status: string;
};

export type SessionMessageState = {
  sessionTitle?: string;
  tokenUsage?: SessionTokenUsage;
  currentStatus: string;
  currentStep?: string;
  currentText: string;
  tools: SessionTool[];
  todos: SessionTodo[];
  startedAt: number;
};

export type SessionStateOptions = {
  workingDirectory?: string;
  endIndex?: number;
  baseState?: Partial<SessionMessageState>;
};

const SEARCH_TOOL_NAMES = new Set(["glob", "grep", "rg", "ripgrep", "search"]);
const EDIT_TOOL_NAMES = new Set(["edit", "write"]);
const READ_TOOL_NAMES = new Set(["read"]);

export function buildSessionMessageState(
  events: SessionEvent[],
  options: SessionStateOptions = {}
): SessionMessageState {
  const { workingDirectory, endIndex, baseState } = options;
  const startTime = events[0]?.timestamp ?? Date.now();
  const state: SessionMessageState = {
    sessionTitle: baseState?.sessionTitle,
    tokenUsage: baseState?.tokenUsage,
    currentStatus: baseState?.currentStatus ?? "Starting",
    currentStep: baseState?.currentStep,
    currentText: baseState?.currentText ?? "",
    tools: baseState?.tools ? [...baseState.tools] : [],
    todos: baseState?.todos ? [...baseState.todos] : [],
    startedAt: baseState?.startedAt ?? startTime,
  };

  const relevantEvents =
    typeof endIndex === "number" ? events.slice(0, endIndex + 1) : events;

  for (const event of relevantEvents) {
    const eventData = event.data as any;
    const type = event.type;

    if (type === "session.updated") {
      const title = eventData?.properties?.info?.title;
      if (typeof title === "string" && title.trim()) {
        state.sessionTitle = title.trim();
      }
    }

    if (type === "message.updated") {
      const info = eventData?.properties?.info;
      const tokens = info?.tokens;
      if (tokens && typeof tokens === "object") {
        const input = Number(tokens.input ?? 0) || 0;
        const output = Number(tokens.output ?? 0) || 0;
        const reasoning = Number(tokens.reasoning ?? 0) || 0;
        const cacheRead = Number(tokens.cache?.read ?? 0) || 0;
        const cacheWrite = Number(tokens.cache?.write ?? 0) || 0;
        const total = input + output + reasoning;
        const cost = typeof info?.cost === "number" ? info.cost : undefined;
        state.tokenUsage = {
          input,
          output,
          reasoning,
          cacheRead,
          cacheWrite,
          total,
          cost,
        };
      }
    }

    if (type === "message.part.updated") {
      const part = eventData?.properties?.part as any;
      if (!part) continue;

      if (part.type === "tool") {
        const toolState = part.state || {};
        const existingIdx = state.tools.findIndex((t) => t.id === part.id);
        const toolInfo: SessionTool = {
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
          state.tools[existingIdx] = toolInfo;
        } else {
          state.tools.push(toolInfo);
        }

        if (toolState.status === "running") {
          const label = formatToolLabel(toolInfo, workingDirectory);
          state.currentStatus = label ? `Running: ${label}` : "Running";
        }
      } else if (part.type === "text" && part.text) {
        state.currentText = part.text;
        state.currentStatus = "Writing response";
      } else if (part.type === "step-start") {
        state.currentStep = part.metadata?.title || "Thinking";
        state.currentStatus = "Thinking";
      } else if (part.type === "step-finish") {
        state.currentStep = undefined;
      } else if (part.type === "reasoning") {
        state.currentStatus = "Reasoning";
        state.currentStep = "Thinking deeply...";
      }
    } else if (type === "todo.updated") {
      const todos = (eventData?.properties?.todos as any[]) || [];
      state.todos = todos.map((t: any) => ({
        content: t.content || t.text || "",
        status: t.status || "pending",
      }));
    } else if (type === "session.status") {
      const status = eventData?.properties?.status as any;
      if (status?.type === "busy") {
        state.currentStatus = "Working";
      } else if (status?.type === "retry") {
        state.currentStatus = "Retrying...";
      }
    }
  }

  return state;
}

function formatToolLabel(tool: SessionTool, workingDirectory?: string): string | null {
  const title = tool.title?.trim() ?? "";
  const name = tool.name?.trim() ?? "";
  if (!title && !name) return null;

  const normalizedTitle = title ? trimToolPath(title, workingDirectory) : "";
  const toolName = name.toLowerCase();

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

function trimToolPath(label: string, workingDirectory?: string): string {
  let trimmed = label.trim();
  if (!trimmed) return trimmed;

  if (workingDirectory && trimmed.startsWith(`${workingDirectory}/`)) {
    trimmed = trimmed.slice(workingDirectory.length + 1);
  }

  trimmed = trimmed.replace(/(^|\/)\.worktrees\/[^/]+\//, "");
  trimmed = trimmed.replace(/^\//, "");
  return trimmed;
}
