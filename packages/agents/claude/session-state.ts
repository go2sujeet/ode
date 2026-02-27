import type { SessionMessageState, SessionTodo } from "@/utils/session-inspector";
import {
  applyAnthropicStyleStreamEvent,
  applyAssistantBlocks,
  applyUserToolResults,
  extractPrefixedRecord,
  extractSessionTitle,
  type StreamStateMaps,
  type StreamToolState,
} from "@/agents/session-state/shared";

export type ClaudeRawRecord = {
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

export type ClaudeInspectorToolState = StreamToolState;

export type ClaudeStreamStateMaps = StreamStateMaps<ClaudeInspectorToolState>;

function normalizeTodoStatus(status: unknown): string {
  if (typeof status !== "string") return "pending";
  const normalized = status.trim().toLowerCase();
  if (!normalized) return "pending";
  if (normalized === "in progress") return "in_progress";
  return normalized.replace(/\s+/g, "_");
}

function parseTodosFromClaudeToolInput(
  toolName: string,
  input: Record<string, unknown> | undefined
): SessionTodo[] | undefined {
  if (!input) return undefined;
  if (!toolName.toLowerCase().includes("todo")) return undefined;

  const todoListCandidate = input.todos ?? input.items ?? input.tasks;
  if (!Array.isArray(todoListCandidate)) return undefined;

  const todos = todoListCandidate
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const contentCandidate = entry.content ?? entry.text ?? entry.title ?? entry.task;
      const content = typeof contentCandidate === "string" ? contentCandidate.trim() : "";
      return {
        content,
        status: normalizeTodoStatus(entry.status),
      };
    })
    .filter((todo) => todo.content.length > 0);

  return todos;
}

export function extractClaudeRecord(
  type: string,
  eventData: Record<string, unknown>,
  eventProps: Record<string, unknown>
): ClaudeRawRecord | null {
  return extractPrefixedRecord<ClaudeRawRecord>(type, "claude.raw.", eventData, eventProps);
}

export function applyClaudeRecordToState(
  state: SessionMessageState,
  record: ClaudeRawRecord,
  streamState: ClaudeStreamStateMaps
): void {
  const { textByIndex, thinkingByIndex, toolByIndex, toolById } = streamState;
  const sessionTitle = extractSessionTitle(record);
  if (sessionTitle) {
    state.sessionTitle = sessionTitle;
  }

  if (record.type === "assistant") {
    const blocks = record.message?.content ?? [];
    for (const block of blocks) {
      if (block?.type !== "tool_use") continue;
      const toolName = typeof block.name === "string" ? block.name : "";
      const input = block.input && typeof block.input === "object" && !Array.isArray(block.input)
        ? block.input as Record<string, unknown>
        : undefined;
      const parsedTodos = parseTodosFromClaudeToolInput(toolName, input);
      if (parsedTodos) {
        state.todos = parsedTodos;
      }
    }
    applyAssistantBlocks(state, blocks, { toolById }, "claude-tool");
    return;
  }

  if (record.type === "user") {
    applyUserToolResults(state, record.message?.content ?? [], { toolById });
    return;
  }

  if (record.type === "result") {
    state.phaseStatus = record.is_error ? "Claude reported an error" : "Finalizing response";
    return;
  }

  if (record.type !== "stream_event") {
    return;
  }

  if (record.event?.type === "content_block_start" && record.event.content_block?.type === "tool_use") {
    const block = record.event.content_block;
    const toolName = typeof block.name === "string" ? block.name : "";
    const input = block.input && typeof block.input === "object" && !Array.isArray(block.input)
      ? block.input as Record<string, unknown>
      : undefined;
    const parsedTodos = parseTodosFromClaudeToolInput(toolName, input);
    if (parsedTodos) {
      state.todos = parsedTodos;
    }
  }

  applyAnthropicStyleStreamEvent(state, record, {
    textByIndex,
    thinkingByIndex,
    toolByIndex,
    toolById,
  }, "claude-tool");

  if (record.event?.type === "content_block_delta" && record.event.delta?.type === "input_json_delta") {
    const index = typeof record.event.index === "number" ? record.event.index : undefined;
    if (typeof index === "number") {
      const tool = toolByIndex.get(index);
      if (tool) {
        const parsedTodos = parseTodosFromClaudeToolInput(tool.name, tool.input);
        if (parsedTodos) {
          state.todos = parsedTodos;
        }
      }
    }
  }
}
