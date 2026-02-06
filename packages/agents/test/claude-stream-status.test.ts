import { describe, expect, it } from "bun:test";
import { mapClaudeRecordToSessionEvents } from "../claude/client";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildLiveStatusMessage } from "../../utils/status";

describe("claude stream status mapping", () => {
  it("emits drafting status and cumulative text updates", () => {
    const textByIndex = new Map<number, string>();
    const toolByIndex = new Map<number, { id: string; name: string }>();

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
      toolByIndex
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
      toolByIndex
    );

    expect(events[0]?.type).toBe("session.status");
    expect(events[0]?.properties?.status).toBe("Drafting response");
    expect(events[1]?.type).toBe("message.part.updated");
    expect((events[1]?.properties?.part as { text?: string })?.text).toBe("Hello world");
  });

  it("emits running and finished tool statuses", () => {
    const textByIndex = new Map<number, string>();
    const toolByIndex = new Map<number, { id: string; name: string }>();

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
      toolByIndex
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
      toolByIndex
    );

    expect(startEvents[0]?.properties?.status).toBe("Running tool: Read");
    expect((startEvents[1]?.properties?.part as { state?: { status?: string } })?.state?.status).toBe("running");
    expect(stopEvents[0]?.properties?.status).toBe("Finished tool: Read");
    expect((stopEvents[1]?.properties?.part as { state?: { status?: string } })?.state?.status).toBe("completed");
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
