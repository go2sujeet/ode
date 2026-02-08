import { describe, expect, it } from "bun:test";
import { buildStatusMessageForAgent } from "../runtime/status-message";
import type { AgentAdapter, StatusMessageRequest } from "../types";
import type { SessionMessageState } from "@/utils/session-inspector";

function makeRequest(): StatusMessageRequest {
  return {
    sessionId: "claude_session",
    channelId: "C123",
    threadId: "T123",
    statusMessageTs: "S123",
    startedAt: Date.now() - 5_000,
    currentText: "",
  };
}

function makeState(): SessionMessageState {
  return {
    sessionTitle: "ClaudeCode",
    phaseStatus: "Thinking",
    currentText: "Draft response",
    tools: [],
    todos: [],
    startedAt: Date.now() - 5_000,
  };
}

describe("buildStatusMessageForAgent", () => {
  it("uses shared provider renderer for Slack updates", () => {
    const agent = {
      getProviderForSession: () => "claudecode",
      buildStatusMessage: () => "custom status",
    } as unknown as AgentAdapter;

    const text = buildStatusMessageForAgent({
      agent,
      request: makeRequest(),
      workingPath: "/tmp/project",
      state: makeState(),
      statusMessageFormat: "medium",
    });

    expect(text).toContain("*ClaudeCode*");
    expect(text).not.toBe("custom status");
  });
});
