import {
  applyClaudeRecordToState,
  extractClaudeRecord,
} from "@/agents/claude/session-state";
import { applyCodexRecordToState, extractCodexRecord } from "@/agents/codex/session-state";
import { applyKiroRecordToState, extractKiroRecord } from "@/agents/kiro/session-state";
import { applyKimiRecordToState, extractKimiRecord } from "@/agents/kimi/session-state";
import { applyKiloRecordToState, extractKiloRecord } from "@/agents/kilo/session-state";
import { applyQwenRecordToState, extractQwenRecord } from "@/agents/qwen/session-state";
import { applyGooseRecordToState, extractGooseRecord } from "@/agents/goose/session-state";
import { applyGeminiRecordToState, extractGeminiRecord } from "@/agents/gemini/session-state";
import {
  extractSessionTitle,
  type StreamStateMaps,
  type StreamToolState,
} from "@/agents/session-state/shared";

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
  model?: string;
  agent?: string;
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

type ProviderParser = {
  extract: (
    type: string,
    eventData: Record<string, unknown>,
    eventProps: Record<string, unknown>
  ) => unknown | null;
  apply: (record: unknown) => void;
};

function applySessionUpdatedEvent(state: SessionMessageState, eventProps: Record<string, unknown>): void {
  const sessionTitle = extractSessionTitle(eventProps);
  if (!sessionTitle) return;
  state.sessionTitle = sessionTitle;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractMessageInfo(eventProps: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = asRecord(eventProps.info);
  if (direct) return direct;

  const message = asRecord(eventProps.message);
  if (!message) return undefined;

  const nestedInfo = asRecord(message.info);
  if (nestedInfo) return nestedInfo;
  return message;
}

function applyMessageUpdatedEvent(state: SessionMessageState, eventProps: Record<string, unknown>): void {
  const info = extractMessageInfo(eventProps);
  if (!info) return;

  const modelCandidate =
    (typeof info.modelID === "string" ? info.modelID : undefined)
    ?? (typeof info.modelId === "string" ? info.modelId : undefined)
    ?? (typeof info.model === "string" ? info.model : undefined);
  if (typeof modelCandidate === "string" && modelCandidate.trim()) {
    state.model = modelCandidate;
  }

  const agentCandidate =
    (typeof info.agent === "string" ? info.agent : undefined)
    ?? (typeof info.agentName === "string" ? info.agentName : undefined)
    ?? (typeof info.assistant === "string" ? info.assistant : undefined);
  if (typeof agentCandidate === "string" && agentCandidate.trim()) {
    state.agent = agentCandidate;
  }

  const tokenContainer =
    asRecord(info.tokens)
    ?? asRecord(info.tokenUsage)
    ?? asRecord(info.usage);
  const cacheContainer =
    asRecord(tokenContainer?.cache)
    ?? asRecord(tokenContainer?.cache_tokens)
    ?? asRecord(tokenContainer?.cacheTokens);

  const tokens = tokenContainer;
  if (tokens && typeof tokens === "object") {
    const hasTokenSignal = [
      tokens.input,
      tokens.input_tokens,
      tokens.output,
      tokens.output_tokens,
      tokens.reasoning,
      tokens.reasoning_tokens,
      tokens.total,
      tokens.total_tokens,
      cacheContainer?.read,
      cacheContainer?.write,
      cacheContainer?.input_tokens,
      cacheContainer?.output_tokens,
    ].some((value) => value !== undefined && value !== null);
    if (!hasTokenSignal) {
      return;
    }

    const input = asNumber(tokens.input ?? tokens.input_tokens) ?? 0;
    const output = asNumber(tokens.output ?? tokens.output_tokens) ?? 0;
    const reasoning = asNumber(tokens.reasoning ?? tokens.reasoning_tokens) ?? 0;
    const cacheRead = asNumber(cacheContainer?.read ?? cacheContainer?.input_tokens) ?? 0;
    const cacheWrite = asNumber(cacheContainer?.write ?? cacheContainer?.output_tokens) ?? 0;
    const reportedTotal = asNumber(tokens.total ?? tokens.total_tokens);
    const total = typeof reportedTotal === "number" && Number.isFinite(reportedTotal)
      ? reportedTotal
      : input + output + reasoning + cacheRead + cacheWrite;
    const cost = asNumber(info.cost ?? tokens.cost);
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

function applySessionStatusEvent(state: SessionMessageState, eventProps: Record<string, unknown>): void {
  const statusValue = (eventProps as { status?: unknown }).status;
  const formattedStatus = formatSessionStatus(statusValue);
  if (!formattedStatus) return;
  if (
    formattedStatus === "Working"
    && state.phaseStatus
    && state.phaseStatus !== "Working"
    && state.phaseStatus !== "Waiting"
  ) {
    return;
  }
  state.phaseStatus = formattedStatus;
}

function normalizeReasoningStatus(text: string): string {
  const compact = text
    .replace(/[*_`#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return "Thinking";
  const maxLength = 90;
  const truncated = compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
  return `Thinking: ${truncated}`;
}

function applyMessagePartUpdatedEvent(state: SessionMessageState, eventProps: Record<string, unknown>): void {
  const part = (eventProps as { part?: Record<string, unknown> }).part;
  if (!part) return;
  const isSessionScopedPart = typeof part.sessionID === "string";

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

    if (!isSessionScopedPart) {
      return;
    }

    if (toolInfo.status === "running" || toolInfo.status === "pending") {
      state.phaseStatus = `Running tool: ${toolInfo.name}`;
    } else if (toolInfo.status === "completed") {
      state.phaseStatus = `Finished tool: ${toolInfo.name}`;
    } else if (toolInfo.status === "error") {
      state.phaseStatus = `Tool failed: ${toolInfo.name}`;
    }
    return;
  }

  if (part.type === "text" && typeof part.text === "string") {
    state.currentText = part.text;
    if (isSessionScopedPart) {
      state.phaseStatus = "Drafting response";
    }
    return;
  }

  if (part.type === "reasoning" && typeof part.text === "string") {
    state.thinkingText = part.text;
    if (isSessionScopedPart) {
      state.phaseStatus = normalizeReasoningStatus(part.text);
    }
    return;
  }

  if (part.type === "thinking" && typeof part.text === "string") {
    state.thinkingText = part.text;
    if (isSessionScopedPart) {
      state.phaseStatus = normalizeReasoningStatus(part.text);
    }
  }
}

function applyTodoUpdatedEvent(state: SessionMessageState, eventProps: Record<string, unknown>): void {
  const listCandidate = (eventProps as { todos?: unknown; items?: unknown; tasks?: unknown }).todos
    ?? (eventProps as { items?: unknown }).items
    ?? (eventProps as { tasks?: unknown }).tasks;
  const todoList = Array.isArray(listCandidate) ? listCandidate : [];
  state.todos = todoList
    .filter((todo): todo is Record<string, unknown> => !!todo && typeof todo === "object" && !Array.isArray(todo))
    .map((todo) => ({
      content: typeof (todo.content ?? todo.text ?? todo.title ?? todo.task) === "string"
        ? String(todo.content ?? todo.text ?? todo.title ?? todo.task).trim()
        : "",
      status: typeof todo.status === "string" && todo.status.trim()
        ? todo.status.trim().replace(/\s+/g, "_")
        : "pending",
    }))
    .filter((todo) => todo.content.length > 0);
}

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
      if (typeof status.message === "string" && status.message.trim()) {
        return status.message.trim();
      }
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

export function buildSessionMessageState(
  events: SessionEvent[],
  options: SessionStateOptions = {}
): SessionMessageState {
  const { endIndex, baseState } = options;
  const startTime = events[0]?.timestamp ?? Date.now();
  const state: SessionMessageState = {
    sessionTitle: baseState?.sessionTitle,
    phaseStatus: baseState?.phaseStatus,
    thinkingText: baseState?.thinkingText,
    model: baseState?.model,
    agent: baseState?.agent,
    tokenUsage: baseState?.tokenUsage,
    currentText: baseState?.currentText ?? "",
    tools: baseState?.tools ? [...baseState.tools] : [],
    todos: baseState?.todos ? [...baseState.todos] : [],
    startedAt: baseState?.startedAt ?? startTime,
  };

  const relevantEvents =
    typeof endIndex === "number" ? events.slice(0, endIndex + 1) : events;

  const sharedStreamState: StreamStateMaps<StreamToolState> = {
    textByIndex: new Map<number, string>(),
    thinkingByIndex: new Map<number, string>(),
    toolByIndex: new Map<number, StreamToolState>(),
    toolById: new Map<string, StreamToolState>(),
  };
  const codexToolById = new Map<string, SessionTool>();
  const kimiToolById = new Map<string, SessionTool>();
  const kiloToolById = new Map<string, SessionTool>();
  const geminiToolById = new Map<string, SessionTool>();
  const kiroTodoById = new Map<string, SessionTodo>();
  const kiloStreamState: StreamStateMaps<StreamToolState> = {
    textByIndex: sharedStreamState.textByIndex,
    thinkingByIndex: sharedStreamState.thinkingByIndex,
    toolByIndex: sharedStreamState.toolByIndex,
    toolById: kiloToolById,
  };

  for (const existingTool of state.tools) {
    sharedStreamState.toolById.set(existingTool.id, { ...existingTool });
    codexToolById.set(existingTool.id, { ...existingTool });
    kimiToolById.set(existingTool.id, { ...existingTool });
    kiloToolById.set(existingTool.id, { ...existingTool });
    geminiToolById.set(existingTool.id, { ...existingTool });
  }

  for (const existingTodo of state.todos) {
    const key = existingTodo.content || `todo-${kiroTodoById.size}`;
    kiroTodoById.set(key, { ...existingTodo });
  }

  const providerParsers: ProviderParser[] = [
    {
      extract: extractClaudeRecord,
      apply: (record) => {
        applyClaudeRecordToState(state, record as Parameters<typeof applyClaudeRecordToState>[1], sharedStreamState);
      },
    },
    {
      extract: extractCodexRecord,
      apply: (record) => {
        applyCodexRecordToState(state, record as Parameters<typeof applyCodexRecordToState>[1], codexToolById);
      },
    },
    {
      extract: extractKiroRecord,
      apply: (record) => {
        applyKiroRecordToState(state, record as Parameters<typeof applyKiroRecordToState>[1], kiroTodoById);
      },
    },
    {
      extract: extractKimiRecord,
      apply: (record) => {
        applyKimiRecordToState(state, record as Parameters<typeof applyKimiRecordToState>[1], kimiToolById);
      },
    },
    {
      extract: extractKiloRecord,
      apply: (record) => {
        applyKiloRecordToState(state, record as Parameters<typeof applyKiloRecordToState>[1], kiloStreamState);
      },
    },
    {
      extract: extractQwenRecord,
      apply: (record) => {
        applyQwenRecordToState(state, record as Parameters<typeof applyQwenRecordToState>[1], sharedStreamState);
      },
    },
    {
      extract: extractGooseRecord,
      apply: (record) => {
        applyGooseRecordToState(state, record as Parameters<typeof applyGooseRecordToState>[1], sharedStreamState);
      },
    },
    {
      extract: extractGeminiRecord,
      apply: (record) => {
        applyGeminiRecordToState(state, record as Parameters<typeof applyGeminiRecordToState>[1], geminiToolById);
      },
    },
  ];

  for (const event of relevantEvents) {
    const eventData = unwrapEventData(event.data);
    const eventProps = getEventProperties(eventData);
    const type = event.type;

    let handledByProvider = false;
    for (const parser of providerParsers) {
      const record = parser.extract(type, eventData, eventProps);
      if (!record) continue;
      parser.apply(record);
      handledByProvider = true;
      break;
    }
    if (handledByProvider) {
      continue;
    }

    if (type === "session.updated") {
      applySessionUpdatedEvent(state, eventProps);
    }

    if (type === "message.updated") {
      applyMessageUpdatedEvent(state, eventProps);
    }

    if (type === "session.status") {
      applySessionStatusEvent(state, eventProps);
    }

    if (type === "message.part.updated") {
      applyMessagePartUpdatedEvent(state, eventProps);
    }

    if (type === "todo.updated") {
      applyTodoUpdatedEvent(state, eventProps);
    }
  }

  return state;
}
