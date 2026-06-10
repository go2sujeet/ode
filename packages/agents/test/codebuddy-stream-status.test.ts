import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildLiveStatusMessage } from "../../utils/status";

function rawEvent(timestamp: number, record: Record<string, unknown>) {
  return {
    timestamp,
    type: `codebuddy.raw.${String(record.type ?? "unknown")}`,
    data: {
      properties: {
        record,
      },
    },
  };
}

describe("codebuddy stream status parsing", () => {
  it("hydrates generic Agent tool titles from input_json_delta", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "agent-1",
            name: "Agent",
            input: {},
          },
        },
      }),
      rawEvent(now + 1, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: "{\"description\":\"Map core architecture\",\"prompt\":\"Read-only exploration only.\"}",
          },
        },
      }),
    ]);

    expect(state.tools[0]?.name).toBe("Agent");
    expect(state.tools[0]?.title).toBe("Map core architecture");
    expect(state.phaseStatus).toBe("Running tool: Agent - Map core architecture");
  });

  it("renders CodeBuddy Agent titles instead of a bare tool name", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "agent-2",
              name: "Agent",
              input: {
                description: "Inspect testing gaps",
                prompt: "Review current test coverage and identify risky missing tests.",
              },
            },
          ],
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

    expect(text).toContain("Running tool: Agent - Inspect testing gaps");
    expect(text).toContain("`Agent` Inspect testing gaps");
  });
});
