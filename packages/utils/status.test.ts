import { describe, expect, it } from "bun:test";
import { buildStatusMessageByProvider, type StatusRequest } from "./status";
import type { SessionMessageState } from "./session-inspector";

describe("status message formatting", () => {
  const request: StatusRequest = {
    channelId: "C1",
    threadId: "T1",
    statusMessageTs: "S1",
    startedAt: Date.now() - 60_000,
    currentText: "",
  };

  it("shows waiting subagent hint after threshold", () => {
    const state: SessionMessageState = {
      sessionTitle: "Goose is running...",
      phaseStatus: "Running tool: subagent",
      currentText: "",
      tools: [
        {
          id: "tool-1",
          name: "subagent",
          status: "running",
          metadata: { startedAtMs: Date.now() - 35_000 },
        },
      ],
      todos: [],
      startedAt: Date.now() - 60_000,
    };

    const text = buildStatusMessageByProvider("goose", request, "/tmp/repo", state, "medium");
    expect(text).toContain("Waiting for subagent output");
  });

  it("keeps regular running status before threshold", () => {
    const state: SessionMessageState = {
      sessionTitle: "Goose is running...",
      phaseStatus: "Running tool: subagent",
      currentText: "",
      tools: [
        {
          id: "tool-1",
          name: "subagent",
          status: "running",
          metadata: { startedAtMs: Date.now() - 5_000 },
        },
      ],
      todos: [],
      startedAt: Date.now() - 60_000,
    };

    const text = buildStatusMessageByProvider("goose", request, "/tmp/repo", state, "medium");
    expect(text).toContain("_Running tool: subagent_");
    expect(text).not.toContain("Waiting for subagent output");
  });
});
