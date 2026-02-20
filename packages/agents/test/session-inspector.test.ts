import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildLiveStatusMessage } from "../../utils/status";

describe("session inspector", () => {
  it("parses wrapped OpenCode payload events", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      {
        timestamp: now,
        type: "session.status",
        data: {
          directory: "/tmp/repo",
          payload: {
            type: "session.status",
            properties: {
              sessionID: "ses_1",
              status: { type: "busy" },
            },
          },
        },
      },
      {
        timestamp: now + 1,
        type: "message.part.updated",
        data: {
          directory: "/tmp/repo",
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "tool_1",
                sessionID: "ses_1",
                type: "tool",
                tool: "Read",
                state: {
                  status: "running",
                  input: { filePath: "/tmp/repo/README.md" },
                },
              },
            },
          },
        },
      },
    ]);

    expect(state.phaseStatus).toBe("Working");
    expect(state.tools.length).toBe(1);
    expect(state.tools[0]?.name).toBe("Read");
    expect(state.tools[0]?.status).toBe("running");
  });

  it("renders non-empty preview details from wrapped events", () => {
    const startedAt = Date.now();
    const state = buildSessionMessageState([
      {
        timestamp: startedAt,
        type: "session.updated",
        data: {
          payload: {
            type: "session.updated",
            properties: {
              info: {
                title: "Investigate status preview",
              },
            },
          },
        },
      },
      {
        timestamp: startedAt + 1,
        type: "message.part.updated",
        data: {
          payload: {
            type: "message.part.updated",
            properties: {
              part: {
                id: "tool_2",
                sessionID: "ses_1",
                type: "tool",
                tool: "Grep",
                state: {
                  status: "completed",
                  input: { pattern: "session.status", path: "/tmp/repo" },
                },
              },
            },
          },
        },
      },
    ]);

    const preview = buildLiveStatusMessage(
      {
        channelId: "C1",
        threadId: "T1",
        statusMessageTs: "S1",
        startedAt,
        currentText: "",
      },
      "/tmp/repo",
      state,
      "medium"
    );

    expect(preview).toContain("Investigate status preview");
    expect(preview).toContain("Tool execution");
    expect(preview).toContain("`Grep`");
  });

  it("falls back to session slug when OpenCode title is generic", () => {
    const startedAt = Date.now();
    const state = buildSessionMessageState([
      {
        timestamp: startedAt,
        type: "session.updated",
        data: {
          payload: {
            type: "session.updated",
            properties: {
              info: {
                title: "New session - 2026-02-20T05:51:37.251Z",
                slug: "neon-harbor",
              },
            },
          },
        },
      },
    ]);

    expect(state.sessionTitle).toBe("Neon Harbor");
  });
});
