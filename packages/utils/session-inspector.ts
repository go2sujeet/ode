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

type ClaudeRawRecord = {
  type?: string;
  event?: {
    type?: string;
    index?: number;
    content_block?: Record<string, unknown>;
    delta?: Record<string, unknown>;
  };
  message?: {
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>;
  };
  result?: string;
  is_error?: boolean;
  error?: string;
  session_id?: string;
};

type ClaudeInspectorToolState = SessionTool & {
  inputBuffer?: string;
};

type CodexRawRecord = {
  type?: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    status?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

function unwrapEventData(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const record = data as Record<string, unknown>;
  const payload = record.payload;
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return record;
}

function getEventProperties(data: Record<string, unknown>): Record<string, unknown> {
  const properties = data.properties;
  if (properties && typeof properties === "object") {
    return properties as Record<string, unknown>;
  }
  return data;
}

function formatSessionStatus(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const status = value as {
    type?: string;
    message?: string;
    next?: number;
  };

  switch (status.type) {
    case "busy":
      return "Working";
    case "idle":
      return "Waiting";
    case "retry": {
      const base = typeof status.message === "string" && status.message.trim()
        ? `Retrying: ${status.message.trim()}`
        : "Retrying";
      const seconds = typeof status.next === "number"
        ? Math.max(0, Math.ceil((status.next - Date.now()) / 1000))
        : undefined;
      return seconds !== undefined ? `${base} in ${seconds}s` : base;
    }
    default:
      return undefined;
  }
}

function tryParseObject(input: string): Record<string, unknown> | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractSessionTitle(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    const record = current as Record<string, unknown>;
    const directTitle = record.title;
    if (typeof directTitle === "string") {
      const trimmed = directTitle.trim();
      if (trimmed && !trimmed.startsWith("New session")) {
        return trimmed;
      }
    }

    const info = record.info;
    if (info && typeof info === "object" && !Array.isArray(info)) {
      const infoTitle = (info as Record<string, unknown>).title;
      if (typeof infoTitle === "string") {
        const trimmed = infoTitle.trim();
        if (trimmed && !trimmed.startsWith("New session")) {
          return trimmed;
        }
      }
    }

    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") queue.push(nested);
    }
  }

  return undefined;
}

function updateTool(state: SessionMessageState, tool: SessionTool): void {
  const existingIdx = state.tools.findIndex((current) => current.id === tool.id);
  if (existingIdx >= 0) {
    state.tools[existingIdx] = tool;
    return;
  }
  state.tools.push(tool);
}

function composeIndexedText(parts: Map<number, string>): string {
  if (parts.size === 0) return "";
  const sorted = [...parts.entries()].sort((a, b) => a[0] - b[0]);
  return sorted.map(([, text]) => text).join("");
}

function getClaudeRecordFromEvent(
  type: string,
  eventData: Record<string, unknown>,
  eventProps: Record<string, unknown>
): ClaudeRawRecord | null {
  if (!type.startsWith("claude.raw.")) return null;
  const candidate = eventProps.record ?? eventData.record;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate as ClaudeRawRecord;
}

function getCodexRecordFromEvent(
  type: string,
  eventData: Record<string, unknown>,
  eventProps: Record<string, unknown>
): CodexRawRecord | null {
  if (!type.startsWith("codex.raw.")) return null;
  const candidate = eventProps.event ?? eventData.event;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate as CodexRawRecord;
}

function applyCodexRecordToState(
  state: SessionMessageState,
  record: CodexRawRecord,
  toolById: Map<string, SessionTool>
): void {
  const item = record.item;
  const eventType = typeof record.type === "string" ? record.type : "";

  if (eventType === "thread.started") {
    state.phaseStatus = "Thinking";
    return;
  }

  if (eventType === "turn.started") {
    state.phaseStatus = "Thinking";
    return;
  }

  if (eventType === "turn.completed") {
    const input = Number(record.usage?.input_tokens ?? 0) || 0;
    const output = Number(record.usage?.output_tokens ?? 0) || 0;
    state.tokenUsage = {
      input,
      output,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: input + output,
    };
    if (!state.phaseStatus || state.phaseStatus === "Thinking") {
      state.phaseStatus = "Finalizing response";
    }
    return;
  }

  if (eventType === "error") {
    const message = typeof record.error?.message === "string" ? record.error.message.trim() : "";
    state.phaseStatus = message ? `Codex error: ${message}` : "Codex reported an error";
    return;
  }

  if (!item || typeof item !== "object") return;
  const itemType = typeof item.type === "string" ? item.type : "";
  const itemId = typeof item.id === "string" && item.id.trim()
    ? item.id.trim()
    : `codex-item-${Date.now()}`;

  if (itemType === "reasoning") {
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (text) {
      state.thinkingText = text;
    }
    state.phaseStatus = "Thinking";
    return;
  }

  if (itemType === "command_execution") {
    const command = typeof item.command === "string" ? item.command.trim() : "";
    const output = typeof item.aggregated_output === "string" ? item.aggregated_output : undefined;
    const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
    const itemStatus = typeof item.status === "string" ? item.status : undefined;

    const existing = toolById.get(itemId);
    const nextStatus = itemStatus === "in_progress"
      ? "running"
      : exitCode === undefined || exitCode === 0
        ? "completed"
        : "error";

    const tool: SessionTool = {
      id: itemId,
      name: "Bash",
      status: nextStatus,
      input: command ? { command } : existing?.input,
      output: output ?? existing?.output,
      error: nextStatus === "error"
        ? output || (typeof exitCode === "number" ? `Command failed with exit code ${exitCode}` : "Command failed")
        : existing?.error,
    };
    toolById.set(itemId, tool);
    updateTool(state, tool);

    if (nextStatus === "running") {
      state.phaseStatus = "Running tool: Bash";
    } else if (nextStatus === "error") {
      state.phaseStatus = "Tool failed: Bash";
    } else {
      state.phaseStatus = "Finished tool: Bash";
    }
    return;
  }

  if (itemType === "agent_message") {
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (text) {
      state.currentText = text;
      state.phaseStatus = "Drafting response";
    }
  }
}

function applyClaudeRecordToState(
  state: SessionMessageState,
  record: ClaudeRawRecord,
  textByIndex: Map<number, string>,
  thinkingByIndex: Map<number, string>,
  toolByIndex: Map<number, ClaudeInspectorToolState>,
  toolById: Map<string, ClaudeInspectorToolState>
): void {
  const sessionTitle = extractSessionTitle(record);
  if (sessionTitle) {
    state.sessionTitle = sessionTitle;
  }

  if (record.type === "assistant") {
    const blocks = record.message?.content ?? [];
    const text = blocks
      .filter((block) => block?.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    if (text) {
      state.currentText = text;
      state.phaseStatus = "Drafting response";
    }

    for (const block of blocks) {
      if (block?.type !== "tool_use") continue;
      const toolId = typeof block.id === "string" && block.id.trim()
        ? block.id
        : `claude-tool-${Date.now()}`;
      const toolName = typeof block.name === "string" && block.name.trim()
        ? block.name
        : "tool";
      const input = block.input && typeof block.input === "object"
        ? (block.input as Record<string, unknown>)
        : undefined;

      const existing = toolById.get(toolId);
      const tool: ClaudeInspectorToolState = {
        id: toolId,
        name: toolName,
        status: existing?.status === "completed" || existing?.status === "error"
          ? existing.status
          : "running",
        input: input ?? existing?.input,
        output: existing?.output,
        error: existing?.error,
        title: existing?.title,
        metadata: existing?.metadata,
      };
      toolById.set(toolId, tool);
      updateTool(state, tool);
      if (tool.status === "running") {
        state.phaseStatus = `Running tool: ${toolName}`;
      }
    }
    return;
  }

  if (record.type === "user") {
    const blocks = record.message?.content ?? [];
    for (const block of blocks) {
      if (block?.type !== "tool_result") continue;
      const toolId = typeof block.tool_use_id === "string" && block.tool_use_id.trim()
        ? block.tool_use_id
        : "";
      if (!toolId) continue;

      const existing = toolById.get(toolId);
      if (!existing) continue;

      const hasError = block.is_error === true;
      const output = typeof block.content === "string" ? block.content : undefined;
      const updated: ClaudeInspectorToolState = {
        ...existing,
        status: hasError ? "error" : "completed",
        output,
        error: hasError ? output : existing.error,
      };
      toolById.set(toolId, updated);
      updateTool(state, updated);
      state.phaseStatus = `${hasError ? "Tool failed" : "Finished tool"}: ${updated.name}`;
    }
    return;
  }

  if (record.type === "result") {
    state.phaseStatus = record.is_error ? "Claude reported an error" : "Finalizing response";
    return;
  }

  if (record.type !== "stream_event" || !record.event?.type) {
    return;
  }

  const eventType = record.event.type;
  const index = typeof record.event.index === "number" ? record.event.index : undefined;

  switch (eventType) {
    case "message_start": {
      state.phaseStatus = "Thinking";
      return;
    }
    case "content_block_start": {
      const block = record.event.content_block;
      if (block?.type === "tool_use") {
        const toolId = typeof block.id === "string" && block.id.trim()
          ? block.id
          : typeof index === "number"
            ? `claude-tool-${index}`
            : `claude-tool-${Date.now()}`;
        const toolName = typeof block.name === "string" && block.name.trim()
          ? block.name
          : "tool";
        const input = block.input && typeof block.input === "object"
          ? (block.input as Record<string, unknown>)
          : undefined;
        const tool: ClaudeInspectorToolState = {
          id: toolId,
          name: toolName,
          status: "running",
          input,
        };
        toolById.set(toolId, tool);
        if (typeof index === "number") {
          toolByIndex.set(index, tool);
        }
        updateTool(state, tool);
        state.phaseStatus = `Running tool: ${toolName}`;
        return;
      }

      if (block?.type === "thinking") {
        const thinking = typeof block.thinking === "string" ? block.thinking : "";
        if (thinking) {
          state.thinkingText = thinking;
          if (typeof index === "number") {
            thinkingByIndex.set(index, thinking);
          }
        }
        state.phaseStatus = "Thinking";
        return;
      }

      state.phaseStatus = "Drafting response";
      return;
    }
    case "content_block_delta": {
      const delta = record.event.delta;
      if (delta?.type === "text_delta") {
        const chunk = typeof delta.text === "string" ? delta.text : "";
        if (!chunk) return;
        if (typeof index === "number") {
          const next = `${textByIndex.get(index) ?? ""}${chunk}`;
          textByIndex.set(index, next);
          state.currentText = composeIndexedText(textByIndex);
        } else {
          state.currentText = `${state.currentText}${chunk}`;
        }
        state.phaseStatus = "Drafting response";
        return;
      }

      if (delta?.type === "input_json_delta") {
        if (typeof index !== "number") {
          state.phaseStatus = "Running tool";
          return;
        }
        const tool = toolByIndex.get(index);
        if (!tool) {
          state.phaseStatus = "Running tool";
          return;
        }
        const chunk = typeof delta.partial_json === "string" ? delta.partial_json : "";
        if (chunk) {
          tool.inputBuffer = `${tool.inputBuffer ?? ""}${chunk}`;
          const parsedInput = tryParseObject(tool.inputBuffer);
          if (parsedInput) {
            tool.input = parsedInput;
          }
        }
        tool.status = "running";
        toolById.set(tool.id, tool);
        toolByIndex.set(index, tool);
        updateTool(state, tool);
        state.phaseStatus = `Running tool: ${tool.name}`;
        return;
      }

      if (delta?.type === "thinking_delta") {
        const chunk = typeof delta.thinking === "string" ? delta.thinking : "";
        if (!chunk) return;
        if (typeof index === "number") {
          const next = `${thinkingByIndex.get(index) ?? ""}${chunk}`;
          thinkingByIndex.set(index, next);
          state.thinkingText = next;
        } else {
          state.thinkingText = `${state.thinkingText ?? ""}${chunk}`;
        }
        state.phaseStatus = "Thinking";
      }
      return;
    }
    case "content_block_stop": {
      if (typeof index !== "number") {
        state.phaseStatus = "Finished step";
        return;
      }
      const tool = toolByIndex.get(index);
      if (!tool) {
        state.phaseStatus = "Finished step";
        return;
      }
      tool.status = "completed";
      toolById.set(tool.id, tool);
      toolByIndex.set(index, tool);
      updateTool(state, tool);
      state.phaseStatus = `Finished tool: ${tool.name}`;
      return;
    }
    case "message_stop": {
      state.phaseStatus = "Finalizing response";
      return;
    }
    default:
      return;
  }
}

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

  const claudeTextByIndex = new Map<number, string>();
  const claudeThinkingByIndex = new Map<number, string>();
  const claudeToolByIndex = new Map<number, ClaudeInspectorToolState>();
  const claudeToolById = new Map<string, ClaudeInspectorToolState>();
  const codexToolById = new Map<string, SessionTool>();

  for (const existingTool of state.tools) {
    claudeToolById.set(existingTool.id, { ...existingTool });
    codexToolById.set(existingTool.id, { ...existingTool });
  }

  for (const event of relevantEvents) {
    const eventData = unwrapEventData(event.data);
    const eventProps = getEventProperties(eventData);
    const type = event.type;

    const claudeRecord = getClaudeRecordFromEvent(type, eventData, eventProps);
    if (claudeRecord) {
      applyClaudeRecordToState(
        state,
        claudeRecord,
        claudeTextByIndex,
        claudeThinkingByIndex,
        claudeToolByIndex,
        claudeToolById
      );
      continue;
    }

    const codexRecord = getCodexRecordFromEvent(type, eventData, eventProps);
    if (codexRecord) {
      applyCodexRecordToState(state, codexRecord, codexToolById);
      continue;
    }

    if (type === "session.updated") {
      const info = eventProps.info as { title?: unknown } | undefined;
      const title = info?.title;
      if (typeof title === "string") {
        const trimmedTitle = title.trim();
        if (trimmedTitle && !trimmedTitle.startsWith("New session")) {
          state.sessionTitle = trimmedTitle;
        }
      }
    }

    if (type === "message.updated") {
      const info = eventProps.info as
        | {
            tokens?: {
              input?: unknown;
              output?: unknown;
              reasoning?: unknown;
              cache?: { read?: unknown; write?: unknown };
            };
            cost?: unknown;
          }
        | undefined;
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
      const statusValue = (eventProps as { status?: unknown }).status;
      const formattedStatus = formatSessionStatus(statusValue);
      if (formattedStatus) {
        state.phaseStatus = formattedStatus;
      }
    }

    if (type === "message.part.updated") {
      const part = (eventProps as { part?: Record<string, unknown> }).part;
      if (!part) continue;

      if (part.type === "tool") {
        const toolState = (part.state || {}) as Record<string, unknown>;
        const existingIdx = state.tools.findIndex((t) => t.id === part.id);
        const toolInfo: SessionTool = {
          id: typeof part.id === "string" ? part.id : "unknown-tool",
          name: typeof part.tool === "string" ? part.tool : "Unknown tool",
          status: typeof toolState.status === "string" ? toolState.status : "pending",
          title: typeof toolState.title === "string" ? toolState.title : undefined,
          input: toolState.input && typeof toolState.input === "object"
            ? toolState.input as Record<string, unknown>
            : undefined,
          output: typeof toolState.output === "string" ? toolState.output : undefined,
          error: typeof toolState.error === "string" ? toolState.error : undefined,
          metadata: toolState.metadata as Record<string, unknown> | undefined,
        };

        if (existingIdx >= 0) {
          state.tools[existingIdx] = toolInfo;
        } else {
          state.tools.push(toolInfo);
        }
      } else if (part.type === "text" && typeof part.text === "string") {
        state.currentText = part.text;
      } else if (part.type === "thinking" && typeof part.text === "string") {
        state.thinkingText = part.text;
      }
    } else if (type === "todo.updated") {
      const todos = ((eventProps as { todos?: unknown }).todos as any[]) || [];
      state.todos = todos.map((t: any) => ({
        content: t.content || t.text || "",
        status: t.status || "pending",
      }));
    }
  }

  return state;
}
