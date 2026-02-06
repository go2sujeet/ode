import { describe, expect, it } from "bun:test";
import { mapClaudeRecordToSessionEvents } from "../claude/client";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildLiveStatusMessage } from "../../utils/status";

describe("claude stream status mapping", () => {
  it("emits drafting status and cumulative text updates", () => {
    const textByIndex = new Map<number, string>();
    const toolByIndex = new Map<number, any>();
    const thinkingByIndex = new Map<number, string>();

    mapClaudeRecordToSessionEvents(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        },
      },
      "session-1",
      textByIndex,
      toolByIndex,
      thinkingByIndex
    );

    const events = mapClaudeRecordToSessionEvents(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " world" },
        },
      },
      "session-1",
      textByIndex,
      toolByIndex,
      thinkingByIndex
    );

    expect(events[0]?.type).toBe("session.status");
    expect(events[0]?.properties?.status).toBe("Drafting response");
    expect(events[1]?.type).toBe("message.part.updated");
    expect((events[1]?.properties?.part as { text?: string })?.text).toBe("Hello world");
  });

  it("emits running and finished tool statuses", () => {
    const textByIndex = new Map<number, string>();
    const toolByIndex = new Map<number, any>();
    const thinkingByIndex = new Map<number, string>();

    const startEvents = mapClaudeRecordToSessionEvents(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { filePath: "README.md" },
          },
        },
      },
      "session-1",
      textByIndex,
      toolByIndex,
      thinkingByIndex
    );

    const stopEvents = mapClaudeRecordToSessionEvents(
      {
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: 1,
        },
      },
      "session-1",
      textByIndex,
      toolByIndex,
      thinkingByIndex
    );

    expect(startEvents[0]?.properties?.status).toBe("Running tool: Read");
    expect((startEvents[1]?.properties?.part as { state?: { status?: string } })?.state?.status).toBe("running");
    expect(stopEvents[0]?.properties?.status).toBe("Finished tool: Read");
    expect((stopEvents[1]?.properties?.part as { state?: { status?: string } })?.state?.status).toBe("completed");
  });

  it("captures tool input deltas and thinking content", () => {
    const textByIndex = new Map<number, string>();
    const toolByIndex = new Map<number, any>();
    const thinkingByIndex = new Map<number, string>();

    mapClaudeRecordToSessionEvents(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 2,
          content_block: {
            type: "tool_use",
            id: "tool-2",
            name: "Bash",
            input: {},
          },
        },
      },
      "session-1",
      textByIndex,
      toolByIndex,
      thinkingByIndex
    );

    const toolDeltaEvents = mapClaudeRecordToSessionEvents(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 2,
          delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
        },
      },
      "session-1",
      textByIndex,
      toolByIndex,
      thinkingByIndex
    );

    const thinkingEvents = mapClaudeRecordToSessionEvents(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 3,
          delta: { type: "thinking_delta", thinking: "Plan next step" },
        },
      },
      "session-1",
      textByIndex,
      toolByIndex,
      thinkingByIndex
    );

    expect((toolDeltaEvents[1]?.properties?.part as { state?: { input?: Record<string, string> } })?.state?.input)
      .toEqual({ command: "ls" });
    expect((thinkingEvents[1]?.properties?.part as { type?: string; text?: string })?.type).toBe("thinking");
    expect((thinkingEvents[1]?.properties?.part as { text?: string })?.text).toBe("Plan next step");
  });

  it("extracts session title from claude records", () => {
    const events = mapClaudeRecordToSessionEvents(
      {
        type: "meta",
        info: {
          title: "Fix Slack status updates",
        },
      },
      "session-1",
      new Map<number, string>(),
      new Map<number, any>(),
      new Map<number, string>()
    );

    expect(events[0]?.type).toBe("session.updated");
    expect((events[0]?.properties?.info as { title?: string })?.title).toBe("Fix Slack status updates");
  });

  it("renders phase status in live status message", () => {
    const state = buildSessionMessageState([
      {
        timestamp: Date.now(),
        type: "session.status",
        data: { properties: { status: "Drafting response" } },
      },
    ]);

    const text = buildLiveStatusMessage(
      {
        channelId: "C1",
        threadId: "T1",
        statusMessageTs: "S1",
        startedAt: Date.now(),
        currentText: "",
      },
      "/tmp/project",
      state,
      "medium"
    );

    expect(text).toContain("Drafting response");
  });
});
