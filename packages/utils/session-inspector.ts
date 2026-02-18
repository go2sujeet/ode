import {
  applyClaudeRecordToState,
  extractClaudeRecord,
  type ClaudeInspectorToolState,
} from "@/agents/claude/session-state";
import { applyCodexRecordToState, extractCodexRecord } from "@/agents/codex/session-state";
import { applyKiroRecordToState, extractKiroRecord } from "@/agents/kiro/session-state";
import { applyKimiRecordToState, extractKimiRecord } from "@/agents/kimi/session-state";
import { applyKiloRecordToState, extractKiloRecord } from "@/agents/kilo/session-state";
import { applyQwenRecordToState, extractQwenRecord } from "@/agents/qwen/session-state";
import { applyGooseRecordToState, extractGooseRecord } from "@/agents/goose/session-state";

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
  const kimiToolById = new Map<string, SessionTool>();
  const kiloToolById = new Map<string, SessionTool>();
  const kiroTodoById = new Map<string, SessionTodo>();

  for (const existingTool of state.tools) {
    claudeToolById.set(existingTool.id, { ...existingTool });
    codexToolById.set(existingTool.id, { ...existingTool });
    kimiToolById.set(existingTool.id, { ...existingTool });
    kiloToolById.set(existingTool.id, { ...existingTool });
  }

  for (const existingTodo of state.todos) {
    const key = existingTodo.content || `todo-${kiroTodoById.size}`;
    kiroTodoById.set(key, { ...existingTodo });
  }

  for (const event of relevantEvents) {
    const eventData = unwrapEventData(event.data);
    const eventProps = getEventProperties(eventData);
    const type = event.type;

    const claudeRecord = extractClaudeRecord(type, eventData, eventProps);
    if (claudeRecord) {
      applyClaudeRecordToState(state, claudeRecord, {
        textByIndex: claudeTextByIndex,
        thinkingByIndex: claudeThinkingByIndex,
        toolByIndex: claudeToolByIndex,
        toolById: claudeToolById,
      });
      continue;
    }

    const codexRecord = extractCodexRecord(type, eventData, eventProps);
    if (codexRecord) {
      applyCodexRecordToState(state, codexRecord, codexToolById);
      continue;
    }

    const kiroRecord = extractKiroRecord(type, eventData, eventProps);
    if (kiroRecord) {
      applyKiroRecordToState(state, kiroRecord, kiroTodoById);
      continue;
    }

    const kimiRecord = extractKimiRecord(type, eventData, eventProps);
    if (kimiRecord) {
      applyKimiRecordToState(state, kimiRecord, kimiToolById);
      continue;
    }

    const kiloRecord = extractKiloRecord(type, eventData, eventProps);
    if (kiloRecord) {
      applyKiloRecordToState(state, kiloRecord, {
        textByIndex: claudeTextByIndex,
        thinkingByIndex: claudeThinkingByIndex,
        toolByIndex: claudeToolByIndex,
        toolById: kiloToolById,
      });
      continue;
    }

    const qwenRecord = extractQwenRecord(type, eventData, eventProps);
    if (qwenRecord) {
      applyQwenRecordToState(state, qwenRecord, {
        textByIndex: claudeTextByIndex,
        thinkingByIndex: claudeThinkingByIndex,
        toolByIndex: claudeToolByIndex,
        toolById: claudeToolById,
      });
      continue;
    }

    const gooseRecord = extractGooseRecord(type, eventData, eventProps);
    if (gooseRecord) {
      applyGooseRecordToState(state, gooseRecord, {
        textByIndex: claudeTextByIndex,
        thinkingByIndex: claudeThinkingByIndex,
        toolByIndex: claudeToolByIndex,
        toolById: claudeToolById,
      });
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
