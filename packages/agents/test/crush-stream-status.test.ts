import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildStatusMessageByProvider } from "../../utils/status";

function rawEvent(timestamp: number, record: Record<string, unknown>) {
  return {
    timestamp,
    type: `crush.raw.${String(record.type ?? "unknown")}`,
    data: {
      properties: {
        record,
      },
    },
  };
}

describe("crush stream status parsing", () => {
  it("renders Crush database messages as tool lifecycle", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "message",
        sessionId: "99140f16-c954-427d-a8d3-342cdcd23003",
        messageId: "m1",
        role: "assistant",
        model: "gpt-5.1",
        provider: "chainbot",
        parts: [
          {
            type: "tool_call",
            data: {
              id: "call-1",
              name: "view",
              input: "{\"file_path\":\"/tmp/repo/package.json\",\"offset\":0,\"limit\":80}",
              finished: false,
            },
          },
        ],
      }),
      rawEvent(now + 1, {
        type: "message",
        sessionId: "99140f16-c954-427d-a8d3-342cdcd23003",
        messageId: "m2",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            data: {
              tool_call_id: "call-1",
              name: "view",
              content: "<file>package.json</file>",
              is_error: false,
            },
          },
        ],
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "crush",
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

    expect(state.tools[0]?.name).toBe("view");
    expect(state.tools[0]?.status).toBe("completed");
    expect(state.tools[0]?.title).toBe("/tmp/repo/package.json");
    expect(text).toContain("`view` package.json");
  });

  it("uses start and verbose log events as readable live status", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "start",
        model: "chainbot/gpt-5.1",
        prompt: "Inspect the repo and propose focused test coverage.",
      }),
      rawEvent(now + 1, {
        type: "log",
        level: "info",
        text: "Created session for non-interactive run session_id=3180062f-ed4f-4959-ae79-b34ec5c65dbe",
        sessionId: "3180062f-ed4f-4959-ae79-b34ec5c65dbe",
      }),
      rawEvent(now + 15_000, {
        type: "progress",
        model: "chainbot/gpt-5.1",
        prompt: "Inspect the repo and propose focused test coverage.",
        elapsedMs: 15_000,
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "crush",
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

    expect(state.model).toBe("chainbot/gpt-5.1");
    expect(state.sessionTitle).toBe("Crush session 3180062f");
    expect(text).toContain("Crush session 3180062f");
    expect(text).toContain("Waiting for Crush response (15s)");
  });

  it("preserves final Crush text", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "text",
        text: "I found the parser gap and updated the tests.",
      }),
    ]);

    expect(state.currentText).toBe("I found the parser gap and updated the tests.");
    expect(state.phaseStatus).toBe("Finalizing response");
  });
});
