import type { SessionMessageState } from "@/utils/session-inspector";
import {
  buildToolTitle,
  extractPrefixedRecord,
  tryParseObject,
  updateTool,
} from "@/agents/session-state/shared";

export type CrushRawRecord = {
  type?: "start" | "progress" | "log" | "message" | "text";
  text?: string;
  model?: string;
  sessionId?: string;
  level?: string;
  prompt?: string;
  elapsedMs?: number;
  messageId?: string;
  role?: string;
  provider?: string;
  parts?: Array<{
    type?: string;
    data?: Record<string, unknown>;
  }>;
  createdAt?: number;
  updatedAt?: number;
  finishedAt?: number | null;
};

export function extractCrushRecord(
  type: string,
  eventData: Record<string, unknown>,
  eventProps: Record<string, unknown>
): CrushRawRecord | null {
  return extractPrefixedRecord<CrushRawRecord>(type, "crush.raw.", eventData, eventProps);
}

export function applyCrushRecordToState(
  state: SessionMessageState,
  record: CrushRawRecord
): void {
  if (record.type === "start") {
    if (record.model) {
      state.model = record.model;
    }
    state.phaseStatus = record.prompt ? `Starting task: ${record.prompt}` : "Starting Crush";
    return;
  }

  if (record.type === "progress") {
    if (record.model) {
      state.model = record.model;
    }
    const elapsedSeconds = typeof record.elapsedMs === "number" && Number.isFinite(record.elapsedMs)
      ? ` (${Math.max(1, Math.round(record.elapsedMs / 1000))}s)`
      : "";
    state.phaseStatus = record.prompt
      ? `Waiting for Crush response${elapsedSeconds}: ${record.prompt}`
      : `Waiting for Crush response${elapsedSeconds}`;
    return;
  }

  if (record.type === "message") {
    if (record.model) {
      state.model = record.model;
    }
    if (record.sessionId) {
      state.sessionTitle = `Crush session ${record.sessionId.slice(0, 8)}`;
    }
    for (const part of record.parts ?? []) {
      if (part.type === "text" && record.role === "assistant") {
        const text = part.data?.text;
        if (typeof text === "string" && text.trim()) {
          state.currentText = text.trim();
          state.phaseStatus = "Drafting response";
        }
        continue;
      }

      if (part.type === "tool_call") {
        const toolId = typeof part.data?.id === "string" && part.data.id.trim()
          ? part.data.id
          : `${record.messageId ?? "crush"}-${state.tools.length}`;
        const toolName = typeof part.data?.name === "string" && part.data.name.trim()
          ? part.data.name
          : "tool";
        const input = typeof part.data?.input === "string"
          ? tryParseObject(part.data.input) ?? { content: part.data.input }
          : part.data?.input && typeof part.data.input === "object" && !Array.isArray(part.data.input)
            ? part.data.input as Record<string, unknown>
            : undefined;
        const finished = part.data?.finished === true;
        const tool = {
          id: toolId,
          name: toolName,
          status: finished ? "completed" : "running",
          input,
          title: buildToolTitle(toolName, input),
        };
        updateTool(state, tool);
        const detail = tool.title ? `${toolName} - ${tool.title}` : toolName;
        state.phaseStatus = `${finished ? "Finished tool" : "Running tool"}: ${detail}`;
        continue;
      }

      if (part.type === "tool_result") {
        const toolId = typeof part.data?.tool_call_id === "string" && part.data.tool_call_id.trim()
          ? part.data.tool_call_id
          : "";
        if (!toolId) continue;
        const existing = state.tools.find((tool) => tool.id === toolId);
        if (!existing) continue;
        const isError = part.data?.is_error === true;
        const content = typeof part.data?.content === "string" ? part.data.content : undefined;
        const updated = {
          ...existing,
          status: isError ? "error" : "completed",
          output: content || existing.output,
          error: isError ? content || "Crush tool failed" : existing.error,
        };
        updateTool(state, updated);
        const detail = updated.title ? `${updated.name} - ${updated.title}` : updated.name;
        state.phaseStatus = `${isError ? "Tool failed" : "Finished tool"}: ${detail}`;
      }
    }
    return;
  }

  if (record.type === "log" && typeof record.text === "string" && record.text.trim()) {
    const text = record.text.trim();
    if (record.sessionId) {
      state.sessionTitle = `Crush session ${record.sessionId.slice(0, 8)}`;
    }
    if (/Overriding large model/i.test(text)) {
      state.phaseStatus = text.replace(/^Overriding large model for non-interactive run\s*/i, "Using model: ");
      return;
    }
    if (/Created session/i.test(text)) {
      state.phaseStatus = "Started Crush session";
      return;
    }
    if (/Running in non-interactive mode/i.test(text)) {
      state.phaseStatus = "Running Crush in non-interactive mode";
      return;
    }
    if (/Skill turn summary/i.test(text)) {
      state.phaseStatus = "Finalizing Crush response";
      return;
    }
    if (!/shutdown timeout|PostHog|metrics|messages dropped|sending request/i.test(text)) {
      state.phaseStatus = text;
    }
    return;
  }

  if (record.type === "text" && typeof record.text === "string" && record.text.trim()) {
    state.currentText = record.text.trim();
    state.phaseStatus = "Finalizing response";
  }
}
