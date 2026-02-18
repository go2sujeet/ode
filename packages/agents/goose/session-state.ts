import type { SessionMessageState, SessionTool } from "@/utils/session-inspector";

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

export type GooseInspectorToolState = SessionTool & {
  inputBuffer?: string;
};

export type GooseStreamStateMaps = {
  textByIndex: Map<number, string>;
  thinkingByIndex: Map<number, string>;
  toolByIndex: Map<number, GooseInspectorToolState>;
  toolById: Map<string, GooseInspectorToolState>;
};

function updateTool(state: SessionMessageState, tool: SessionTool): void {
  const existingIdx = state.tools.findIndex((current) => current.id === tool.id);
  if (existingIdx >= 0) {
    state.tools[existingIdx] = tool;
    return;
  }
  state.tools.push(tool);
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

function composeIndexedText(parts: Map<number, string>): string {
  if (parts.size === 0) return "";
  const sorted = [...parts.entries()].sort((a, b) => a[0] - b[0]);
  return sorted.map(([, text]) => text).join("");
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

export function extractGooseRecord(
  type: string,
  eventData: Record<string, unknown>,
  eventProps: Record<string, unknown>
): GooseRawRecord | null {
  if (!type.startsWith("goose.raw.")) return null;
  const candidate = eventProps.record ?? eventData.record;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate as GooseRawRecord;
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
        : `goose-tool-${Date.now()}`;
      const toolName = typeof block.name === "string" && block.name.trim()
        ? block.name
        : "tool";
      const input = block.input && typeof block.input === "object"
        ? (block.input as Record<string, unknown>)
        : undefined;

      const existing = toolById.get(toolId);
      const tool: GooseInspectorToolState = {
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
      const updated: GooseInspectorToolState = {
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
    state.phaseStatus = record.is_error ? "Goose reported an error" : "Finalizing response";
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
            ? `goose-tool-${index}`
            : `goose-tool-${Date.now()}`;
        const toolName = typeof block.name === "string" && block.name.trim()
          ? block.name
          : "tool";
        const input = block.input && typeof block.input === "object"
          ? (block.input as Record<string, unknown>)
          : undefined;
        const tool: GooseInspectorToolState = {
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
