import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildStatusMessageByProvider } from "../../utils/status";

function rawEvent(timestamp: number, record: Record<string, unknown>) {
  return {
    timestamp,
    type: `claude.raw.${String(record.type ?? "unknown")}`,
    data: {
      properties: {
        record,
      },
    },
  };
}

describe("claude stream status parsing", () => {
  it("builds cumulative text from raw text deltas", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        },
      }),
      rawEvent(now + 1, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " world" },
        },
      }),
    ]);

    expect(state.phaseStatus).toBe("Drafting response");
    expect(state.currentText).toBe("Hello world");
  });

  it("combines text deltas from multiple content block indexes", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        },
      }),
      rawEvent(now + 1, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: " world" },
        },
      }),
    ]);

    expect(state.currentText).toBe("Hello world");
  });

  it("tracks tool lifecycle and parsed input from raw events", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
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
      }),
      rawEvent(now + 1, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"filePath":"README.md"}' },
        },
      }),
      rawEvent(now + 2, {
        type: "stream_event",
        event: {
          type: "content_block_stop",
          index: 1,
        },
      }),
    ]);

    expect(state.phaseStatus).toBe("Finished tool: Read");
    expect(state.tools.length).toBe(1);
    expect(state.tools[0]?.name).toBe("Read");
    expect(state.tools[0]?.status).toBe("completed");
    expect(state.tools[0]?.input).toEqual({ filePath: "README.md" });
  });

  it("tracks tool lifecycle from assistant tool_use and user tool_result records", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call_1",
              name: "Read",
              input: {
                file_path: "/tmp/repo/README.md",
              },
            },
            {
              type: "tool_use",
              id: "call_2",
              name: "Bash",
              input: {
                command: "ls -la",
              },
            },
          ],
        },
      }),
      rawEvent(now + 1, {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_1",
              content: "README contents",
              is_error: false,
            },
          ],
        },
      }),
    ]);

    expect(state.phaseStatus).toBe("Finished tool: Read");
    expect(state.tools.length).toBe(2);
    expect(state.tools[0]?.name).toBe("Read");
    expect(state.tools[0]?.status).toBe("completed");
    expect(state.tools[0]?.input).toEqual({ file_path: "/tmp/repo/README.md" });
    expect(state.tools[1]?.name).toBe("Bash");
    expect(state.tools[1]?.status).toBe("running");
  });

  it("tracks thinking text from raw thinking deltas", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 2,
          content_block: {
            type: "thinking",
            thinking: "Plan",
          },
        },
      }),
      rawEvent(now + 1, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 2,
          delta: { type: "thinking_delta", thinking: " next step" },
        },
      }),
    ]);

    expect(state.phaseStatus).toBe("Thinking");
    expect(state.thinkingText).toBe("Plan next step");
  });

  it("extracts session title from raw claude records", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "meta",
        info: {
          title: "Fix Slack status updates",
        },
      }),
    ]);

    expect(state.sessionTitle).toBe("Fix Slack status updates");
  });

  it("renders claude status message from raw records", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "meta",
        info: {
          title: "Investigate preview",
        },
      }),
      rawEvent(now + 1, {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-2",
            name: "Grep",
            input: { pattern: "session.status", path: "/tmp/repo" },
          },
        },
      }),
      rawEvent(now + 2, {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Collecting preview details" },
        },
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "claudecode",
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

    expect(text).toContain("Investigate preview");
    expect(text).toContain("Drafting response");
    expect(text).toContain("`Grep`");
    expect(text).toContain("session.status in tmp/repo");
  });

  it("renders assistant-derived tool details in claude status message", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "call_read",
              name: "Read",
              input: {
                file_path: "/tmp/repo/packages/core/index.ts",
              },
            },
            {
              type: "tool_use",
              id: "call_bash",
              name: "Bash",
              input: {
                command: "ls -la",
              },
            },
            {
              type: "tool_use",
              id: "call_task",
              name: "Task",
              input: {
                description: "Explore codebase structure",
                prompt: "Detailed prompt text",
              },
            },
          ],
        },
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "claudecode",
      {
        channelId: "C1",
        threadId: "T1",
        statusMessageTs: "S1",
        startedAt: now,
        currentText: "",
      },
      "/tmp/repo",
      state,
      "aggressive"
    );

    expect(text).toContain("`Read` packages/core/index.ts");
    expect(text).toContain("`Bash` ls -la");
    expect(text).toContain("`Task`");
  });

  it("uses frequency config for latest actions and shows last-N header", () => {
    const now = Date.now();
    const toolUses = Array.from({ length: 9 }, (_, idx) => ({
      type: "tool_use",
      id: `call_${idx + 1}`,
      name: "Read",
      input: {
        file_path: `/tmp/repo/file-${idx + 1}.ts`,
      },
    }));

    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "assistant",
        message: {
          content: toolUses,
        },
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "claudecode",
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

    expect(text).toContain("Tool execution (Last 6 items in 9)");
    expect(text).not.toContain("`Read` file-1.ts");
    expect(text).toContain("`Read` file-9.ts");
  });

  it("uses shared renderer format without inline response body", () => {
    const now = Date.now();
    const longResponse = `${"A".repeat(180)}\n\n${"B".repeat(180)}`;
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: longResponse,
            },
          ],
        },
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "claudecode",
      {
        channelId: "C1",
        threadId: "T1",
        statusMessageTs: "S1",
        startedAt: now,
        currentText: "",
      },
      "/tmp/repo",
      state,
      "minimum"
    );

    expect(text).toContain("Drafting response");
    expect(text).not.toContain(longResponse);
  });

  it("falls back to provider header when title is unavailable", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "stream_event",
        event: {
          type: "message_start",
        },
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "claudecode",
      {
        channelId: "C1",
        threadId: "T1",
        statusMessageTs: "S1",
        startedAt: now,
        currentText: "",
      },
      "/tmp/repo",
      state,
      "minimum"
    );

    expect(text).toContain("*Claude Code Working...*");
  });
});
