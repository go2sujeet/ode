import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildLiveStatusMessage } from "../../utils/status";

function rawEvent(timestamp: number, record: Record<string, unknown>) {
  return {
    timestamp,
    type: `codex.raw.${String(record.type ?? "unknown")}`,
    data: {
      properties: {
        event: record,
      },
    },
  };
}

describe("codex stream status parsing", () => {
  it("captures reasoning and final response text", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "item.completed",
        item: {
          id: "item_1",
          type: "reasoning",
          text: "**Checking files**",
        },
      }),
      rawEvent(now + 1, {
        type: "item.completed",
        item: {
          id: "item_2",
          type: "agent_message",
          text: "done",
        },
      }),
    ]);

    expect(state.thinkingText).toBe("**Checking files**");
    expect(state.currentText).toBe("done");
    expect(state.phaseStatus).toBe("Drafting response");
  });

  it("tracks command execution as tool lifecycle", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "item.started",
        item: {
          id: "item_cmd",
          type: "command_execution",
          command: "/bin/bash -lc ls",
          status: "in_progress",
        },
      }),
      rawEvent(now + 1, {
        type: "item.completed",
        item: {
          id: "item_cmd",
          type: "command_execution",
          command: "/bin/bash -lc ls",
          aggregated_output: "README.md\n",
          exit_code: 0,
          status: "completed",
        },
      }),
    ]);

    expect(state.phaseStatus).toBe("Finished tool: Bash");
    expect(state.tools.length).toBe(1);
    expect(state.tools[0]?.name).toBe("Bash");
    expect(state.tools[0]?.status).toBe("completed");
    expect(state.tools[0]?.input).toEqual({ command: "/bin/bash -lc ls" });
    expect(state.tools[0]?.output).toBe("README.md\n");
  });

  it("renders codex parsed tools in live status message", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "item.started",
        item: {
          id: "item_cmd",
          type: "command_execution",
          command: "git status --short",
          status: "in_progress",
        },
      }),
      rawEvent(now + 1, {
        type: "item.completed",
        item: {
          id: "item_msg",
          type: "agent_message",
          text: "Working on it",
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

    expect(text).toContain("Tool execution");
    expect(text).toContain("`Bash` git status --short");
    expect(text).toContain("Drafting response");
  });
});
