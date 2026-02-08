import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildLiveStatusMessage } from "../../utils/status";

function rawEvent(timestamp: number, record: Record<string, unknown>) {
  return {
    timestamp,
    type: `kimi.raw.${String(record.role ?? "unknown")}`,
    data: {
      properties: {
        record,
      },
    },
  };
}

describe("kimi stream status parsing", () => {
  it("tracks thinking, tool lifecycle, and final response", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        role: "assistant",
        content: [
          {
            type: "think",
            think: "I should inspect the project first.",
          },
        ],
        tool_calls: [
          {
            id: "tool_1",
            function: {
              name: "Shell",
              arguments: '{"command":"ls -la"}',
            },
          },
        ],
      }),
      rawEvent(now + 1, {
        role: "tool",
        tool_call_id: "tool_1",
        content: [
          {
            type: "text",
            text: "<system>Command executed successfully.</system>",
          },
          {
            type: "text",
            text: "README.md\npackage.json",
          },
        ],
      }),
      rawEvent(now + 2, {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "The biggest issue is duplicated agent logic.",
          },
        ],
      }),
    ]);

    expect(state.thinkingText).toBe("I should inspect the project first.");
    expect(state.tools.length).toBe(1);
    expect(state.tools[0]?.name).toBe("Bash");
    expect(state.tools[0]?.status).toBe("completed");
    expect(state.tools[0]?.input).toEqual({ command: "ls -la" });
    expect(state.currentText).toBe("The biggest issue is duplicated agent logic.");
    expect(state.phaseStatus).toBe("Drafting response");
  });

  it("renders parsed kimi tools in live status message", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        role: "assistant",
        tool_calls: [
          {
            id: "tool_2",
            function: {
              name: "ReadFile",
              arguments: '{"path":"/tmp/repo/README.md"}',
            },
          },
        ],
      }),
      rawEvent(now + 1, {
        role: "tool",
        tool_call_id: "tool_2",
        content: [
          {
            type: "text",
            text: "read done",
          },
        ],
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

    expect(text).toContain("Finished tool: Read");
    expect(text).toContain("Tool execution");
    expect(text).toContain("`Read`");
    expect(text).toContain("README.md");
  });

  it("does not mark tool as failed when output text only mentions error keywords", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        role: "assistant",
        tool_calls: [
          {
            id: "tool_3",
            function: {
              name: "ReadFile",
              arguments: '{"path":"/tmp/repo/src/errors.ts"}',
            },
          },
        ],
      }),
      rawEvent(now + 1, {
        role: "tool",
        tool_call_id: "tool_3",
        content: [
          {
            type: "text",
            text: "<system>128 lines read from file starting from line 1.</system>",
          },
          {
            type: "text",
            text: "export const error = new Error('sample');",
          },
        ],
      }),
    ]);

    expect(state.tools[0]?.name).toBe("Read");
    expect(state.tools[0]?.status).toBe("completed");
    expect(state.phaseStatus).toBe("Finished tool: Read");
  });

});
