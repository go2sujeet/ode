import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildLiveStatusMessage } from "../../utils/status";

function rawEvent(timestamp: number, record: Record<string, unknown>) {
  return {
    timestamp,
    type: `qwen.raw.${String(record.type ?? "unknown")}`,
    data: {
      properties: {
        record,
      },
    },
  };
}

describe("qwen stream status parsing", () => {
  it("tracks tool lifecycle and text deltas", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { filePath: "README.md" },
          },
        },
      }),
      rawEvent(now + 1, {
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: 0,
        },
      }),
      rawEvent(now + 2, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "done" },
        },
      }),
    ]);

    expect(state.tools[0]?.name).toBe("Read");
    expect(state.tools[0]?.status).toBe("completed");
    expect(state.currentText).toBe("done");
    expect(state.phaseStatus).toBe("Drafting response");
  });

  it("renders qwen snake_case tool details in live status", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool-2",
            name: "read_file",
            input: { absolute_path: "/tmp/repo/README.md" },
          },
        },
      }),
      rawEvent(now + 1, {
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: 0,
        },
      }),
      rawEvent(now + 2, {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-3",
            name: "list_directory",
            input: { path: "/tmp/repo/packages" },
          },
        },
      }),
    ]);

    const text = buildLiveStatusMessage(
      {
        channelId: "C1",
        threadId: "T1",
        statusMessageTs: "S1",
        startedAt: now,
        currentText: "",
      },
      "/tmp/repo",
      state,
      "medium"
    );

    expect(text).toContain("`read` README.md");
    expect(text).toContain("`list_directory` packages");
  });

});
