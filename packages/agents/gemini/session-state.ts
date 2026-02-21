import type { SessionMessageState, SessionTool } from "@/utils/session-inspector";
import { extractPrefixedRecord, updateTool } from "@/agents/session-state/shared";

export type GeminiRawRecord = {
  type?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  model?: string;
  tool_name?: string;
  tool_id?: string;
  parameters?: Record<string, unknown>;
  status?: string;
  output?: string;
  error?: {
    type?: string;
    message?: string;
  };
};

export function extractGeminiRecord(
  type: string,
  eventData: Record<string, unknown>,
  eventProps: Record<string, unknown>
): GeminiRawRecord | null {
  return extractPrefixedRecord<GeminiRawRecord>(type, "gemini.raw.", eventData, eventProps);
}

export function applyGeminiRecordToState(
  state: SessionMessageState,
  record: GeminiRawRecord,
  toolById: Map<string, SessionTool>
): void {
  const recordType = typeof record.type === "string" ? record.type.trim().toLowerCase() : "";

  if (recordType === "init") {
    state.phaseStatus = "Thinking";
    return;
  }

  if (recordType === "message") {
    const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
    if (role !== "assistant") return;
    const content = typeof record.content === "string" ? record.content : "";
    if (!content) return;
    state.currentText = record.delta ? `${state.currentText}${content}` : content;
    state.phaseStatus = "Drafting response";
    return;
  }

  if (recordType === "tool_use") {
    const toolId = typeof record.tool_id === "string" && record.tool_id.trim()
      ? record.tool_id
      : `gemini-tool-${Date.now()}`;
    const toolName = typeof record.tool_name === "string" && record.tool_name.trim()
      ? record.tool_name
      : "tool";
    const existing = toolById.get(toolId);
    const tool: SessionTool = {
      id: toolId,
      name: toolName,
      status: "running",
      input: record.parameters ?? existing?.input,
      output: existing?.output,
      error: existing?.error,
    };
    toolById.set(toolId, tool);
    updateTool(state, tool);
    state.phaseStatus = `Running tool: ${toolName}`;
    return;
  }

  if (recordType === "tool_result") {
    const toolId = typeof record.tool_id === "string" && record.tool_id.trim() ? record.tool_id : "";
    if (!toolId) return;
    const existing = toolById.get(toolId);
    if (!existing) return;
    const isError = record.status === "error";
    const output = typeof record.output === "string" ? record.output : existing.output;
    const error = isError ? (record.error?.message || output || "Tool failed") : undefined;
    const updated: SessionTool = {
      ...existing,
      status: isError ? "error" : "completed",
      output,
      error,
    };
    toolById.set(toolId, updated);
    updateTool(state, updated);
    state.phaseStatus = `${isError ? "Tool failed" : "Finished tool"}: ${updated.name}`;
    return;
  }

  if (recordType === "result") {
    state.phaseStatus = record.status === "error" ? "Gemini reported an error" : "Finalizing response";
    return;
  }

  if (recordType === "error") {
    state.phaseStatus = record.error?.message
      ? `Gemini error: ${record.error.message}`
      : "Gemini reported an error";
  }
}
