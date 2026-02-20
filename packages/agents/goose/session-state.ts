import type { SessionMessageState, SessionTodo, SessionTool } from "@/utils/session-inspector";
import {
  applyAnthropicStyleStreamEvent,
  applyAssistantBlocks,
  applyUserToolResults,
  extractPrefixedRecord,
  extractSessionTitle,
  type StreamStateMaps,
  type StreamToolState,
  updateTool,
} from "@/agents/session-state/shared";

export type GooseRawRecord = {
  type?: string;
  event?: {
    type?: string;
    index?: number;
    content_block?: Record<string, unknown>;
    delta?: Record<string, unknown>;
  };
  message?: {
    id?: string;
    role?: string;
    created?: number;
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
      toolCall?: {
        status?: string;
        value?: {
          name?: string;
          arguments?: unknown;
        };
      };
      toolResult?: {
        status?: string;
        value?: {
          content?: Array<{ type?: string; text?: string }>;
          isError?: boolean;
        };
      };
    }>;
  };
  result?: string;
  is_error?: boolean;
  error?: string;
  session_id?: string;
};

export type GooseInspectorToolState = StreamToolState;

export type GooseStreamStateMaps = StreamStateMaps<GooseInspectorToolState>;

function normalizeTodoStatus(status: unknown): string {
  if (typeof status !== "string") return "pending";
  const normalized = status.trim().toLowerCase();
  if (!normalized) return "pending";
  if (normalized === "in progress") return "in_progress";
  return normalized.replace(/\s+/g, "_");
}

function parseTodosFromGooseToolInput(toolName: string, input: Record<string, unknown> | undefined): SessionTodo[] | undefined {
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

export function extractGooseRecord(
  type: string,
  eventData: Record<string, unknown>,
  eventProps: Record<string, unknown>
): GooseRawRecord | null {
  return extractPrefixedRecord<GooseRawRecord>(type, "goose.raw.", eventData, eventProps);
}

export function applyGooseRecordToState(
  state: SessionMessageState,
  record: GooseRawRecord,
  streamState: GooseStreamStateMaps
): void {
  const { textByIndex, thinkingByIndex, toolByIndex, toolById } = streamState;
  const sessionTitle = extractSessionTitle(record);
  if (sessionTitle) {
    state.sessionTitle = sessionTitle;
  }

  if (record.type === "complete") {
    state.phaseStatus = "Waiting";
    return;
  }

  if (record.type === "message") {
    const role = typeof record.message?.role === "string" ? record.message.role : "";
    const blocks = record.message?.content ?? [];

    if (role === "assistant") {
      for (const block of blocks) {
        if (block?.type === "text") {
          const chunk = typeof block.text === "string" ? block.text : "";
          if (!chunk) continue;
          const next = `${textByIndex.get(-1) ?? ""}${chunk}`;
          textByIndex.set(-1, next);
          state.currentText = next;
          state.phaseStatus = "Drafting response";
          continue;
        }

        if (block?.type !== "toolRequest") continue;

        const call = block.toolCall?.value;
        const toolName = typeof call?.name === "string" && call.name.trim()
          ? call.name
          : "tool";
        const callId = typeof block.id === "string" && block.id.trim()
          ? block.id
          : `goose-tool-${Date.now()}`;
        const rawArgs = call?.arguments;
        const input = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
          ? rawArgs as Record<string, unknown>
          : typeof rawArgs === "string"
            ? { content: rawArgs }
            : undefined;
        const parsedTodos = parseTodosFromGooseToolInput(toolName, input);
        if (parsedTodos) {
          state.todos = parsedTodos;
        }
        const existing = toolById.get(callId);
        textByIndex.delete(-1);
        state.currentText = "";
        const tool: GooseInspectorToolState = {
          id: callId,
          name: toolName,
          status: "running",
          input: input ?? existing?.input,
          output: existing?.output,
          error: existing?.error,
          title: existing?.title,
          metadata: existing?.metadata,
        };
        toolById.set(callId, tool);
        updateTool(state, tool);
        state.phaseStatus = `Running tool: ${toolName}`;
      }
      return;
    }

    if (role === "user") {
      for (const block of blocks) {
        if (block?.type !== "toolResponse") continue;
        const callId = typeof block.id === "string" && block.id.trim() ? block.id : "";
        if (!callId) continue;
        const existing = toolById.get(callId);
        if (!existing) continue;
        const result = block.toolResult?.value;
        const output = (result?.content ?? [])
          .filter((entry) => entry?.type === "text")
          .map((entry) => entry.text ?? "")
          .join("\n")
          .trim();
        const hasError = result?.isError === true || block.toolResult?.status === "error";
        const updated: GooseInspectorToolState = {
          ...existing,
          status: hasError ? "error" : "completed",
          output: output || existing.output,
          error: hasError ? output || "Tool execution failed" : undefined,
        };
        toolById.set(callId, updated);
        updateTool(state, updated);
        state.phaseStatus = `${hasError ? "Tool failed" : "Finished tool"}: ${updated.name}`;
      }
      return;
    }
  }

  if (record.type === "assistant") {
    applyAssistantBlocks(state, record.message?.content ?? [], { toolById }, "goose-tool");
    return;
  }

  if (record.type === "user") {
    applyUserToolResults(state, record.message?.content ?? [], { toolById });
    return;
  }

  if (record.type === "result") {
    state.phaseStatus = record.is_error ? "Goose reported an error" : "Finalizing response";
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
    const parsedTodos = parseTodosFromGooseToolInput(toolName, input);
    if (parsedTodos) {
      state.todos = parsedTodos;
    }
  }

  applyAnthropicStyleStreamEvent(state, record, {
    textByIndex,
    thinkingByIndex,
    toolByIndex,
    toolById,
  }, "goose-tool");
}
