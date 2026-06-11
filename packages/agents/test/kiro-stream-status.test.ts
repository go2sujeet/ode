import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildLiveStatusMessage, buildStatusMessageByProvider } from "../../utils/status";

describe("kiro stream status parsing", () => {
  it("renders status from normalized session events", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      {
        timestamp: now,
        type: "session.status",
        data: {
          properties: {
            status: {
              type: "busy",
            },
          },
        },
      },
      {
        timestamp: now + 1,
        type: "message.part.updated",
        data: {
          properties: {
            part: {
              id: "kiro-text",
              type: "text",
              text: "Investigating the codebase now.",
            },
          },
        },
      },
    ]);

    expect(state.phaseStatus).toBe("Working");
    expect(state.currentText).toBe("Investigating the codebase now.");

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

    expect(text).toContain("Working");
  });

  it("renders tool execution details for kiro tool events", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      {
        timestamp: now,
        type: "message.part.updated",
        data: {
          properties: {
            part: {
              id: "kiro-tool-1",
              type: "tool",
              tool: "Grep",
              state: {
                status: "completed",
                title: "Search TODO",
                input: {
                  pattern: "TODO|FIXME",
                  path: "/tmp/repo",
                },
              },
            },
          },
        },
      },
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
    expect(text).toContain("`Grep` TODO|FIXME in tmp/repo");
  });

  it("moves task tools into todos and keeps bash details", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      {
        timestamp: now,
        type: "message.part.updated",
        data: {
          properties: {
            part: {
              id: "kiro-tool-1",
              type: "tool",
              tool: "Task",
              state: {
                status: "running",
                title: "Outline plan",
              },
            },
          },
        },
      },
      {
        timestamp: now + 1,
        type: "message.part.updated",
        data: {
          properties: {
            part: {
              id: "kiro-tool-2",
              type: "tool",
              tool: "Bash",
              state: {
                status: "completed",
                input: {
                  command: "rm -rf /tmp/work",
                },
              },
            },
          },
        },
      },
    ]);

    const text = buildStatusMessageByProvider(
      "kiro",
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

    expect(text).toContain("*Tasks*");
    expect(text).toContain("- [~] Outline plan");
    expect(text).toContain("`Bash`");
    expect(text).not.toContain("`Task`");
    expect(text).toContain("rm -rf /tmp/work");
  });

});
