import type { SessionMessageState } from "@/utils/session-inspector";
import {
  applyAnthropicStyleStreamEvent,
  applyAssistantBlocks,
  extractPrefixedRecord,
  type StreamStateMaps,
  type StreamToolState,
} from "@/agents/session-state/shared";

export type CodeBuddyRawRecord = {
  type?: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  errors?: string[];
  event?: {
    type?: string;
    index?: number;
    content_block?: Record<string, unknown>;
    delta?: Record<string, unknown>;
  };
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }> | string;
  };
};

export function extractCodeBuddyRecord(
  type: string,
  eventData: Record<string, unknown>,
  eventProps: Record<string, unknown>
): CodeBuddyRawRecord | null {
  return extractPrefixedRecord<CodeBuddyRawRecord>(type, "codebuddy.raw.", eventData, eventProps);
}

export function applyCodeBuddyRecordToState(
  state: SessionMessageState,
  record: CodeBuddyRawRecord,
  streamState: StreamStateMaps<StreamToolState>
): void {
  if (record.type === "system") {
    state.phaseStatus = "Thinking";
    return;
  }

  if (record.type === "assistant") {
    const content = record.message?.content;
    if (typeof content === "string" && content.trim()) {
      state.currentText = content.trim();
      state.phaseStatus = "Drafting response";
      return;
    }
    if (Array.isArray(content)) {
      applyAssistantBlocks(state, content, { toolById: streamState.toolById }, "codebuddy-tool");
      return;
    }
  }

  if (record.type === "stream_event") {
    applyAnthropicStyleStreamEvent(state, record, streamState, "codebuddy-tool");
    return;
  }

  if (record.type === "result") {
    if (record.is_error) {
      state.phaseStatus = record.errors?.[0] ? `CodeBuddy error: ${record.errors[0]}` : "CodeBuddy reported an error";
    } else {
      if (typeof record.result === "string" && record.result.trim()) {
        state.currentText = record.result.trim();
      }
      state.phaseStatus = "Finalizing response";
    }
  }
}
