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
  phaseStatus?: string;
  thinkingText?: string;
  tokenUsage?: SessionTokenUsage;
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

export function buildSessionMessageState(
  events: SessionEvent[],
  options: SessionStateOptions = {}
): SessionMessageState {
  const { workingDirectory, endIndex, baseState } = options;
  const startTime = events[0]?.timestamp ?? Date.now();
  const state: SessionMessageState = {
    sessionTitle: baseState?.sessionTitle,
    phaseStatus: baseState?.phaseStatus,
    thinkingText: baseState?.thinkingText,
    tokenUsage: baseState?.tokenUsage,
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
      if (typeof title === "string") {
        const trimmedTitle = title.trim();
        if (trimmedTitle && !trimmedTitle.startsWith("New session")) {
          state.sessionTitle = trimmedTitle;
        }
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

    if (type === "session.status") {
      const statusValue = eventData?.properties?.status;
      if (typeof statusValue === "string") {
        const trimmedStatus = statusValue.trim();
        if (trimmedStatus) {
          state.phaseStatus = trimmedStatus;
        }
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
      } else if (part.type === "text" && part.text) {
        state.currentText = part.text;
      } else if (part.type === "thinking" && part.text) {
        state.thinkingText = part.text;
      }
    } else if (type === "todo.updated") {
      const todos = (eventData?.properties?.todos as any[]) || [];
      state.todos = todos.map((t: any) => ({
        content: t.content || t.text || "",
        status: t.status || "pending",
      }));
    }
  }

  return state;
}
