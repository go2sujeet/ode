import { describe, expect, it } from "bun:test";
import { buildSessionMessageState } from "../../utils/session-inspector";
import { buildStatusMessageByProvider } from "../../utils/status";

function rawEvent(timestamp: number, record: Record<string, unknown>) {
  return {
    timestamp,
    type: `gemini.raw.${String(record.type ?? "unknown")}`,
    data: {
      properties: {
        record,
      },
    },
  };
}

describe("gemini stream status parsing", () => {
  it("tracks tool lifecycle and assistant deltas", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "init",
        session_id: "s1",
      }),
      rawEvent(now + 1, {
        type: "tool_use",
        tool_name: "read_file",
        tool_id: "tool-1",
        parameters: { file_path: "README.md" },
      }),
      rawEvent(now + 2, {
        type: "tool_result",
        tool_id: "tool-1",
        status: "success",
        output: "ok",
      }),
      rawEvent(now + 3, {
        type: "message",
        role: "assistant",
        content: "Hello",
        delta: true,
      }),
      rawEvent(now + 4, {
        type: "message",
        role: "assistant",
        content: " world",
        delta: true,
      }),
    ]);

    expect(state.tools[0]?.name).toBe("read_file");
    expect(state.tools[0]?.status).toBe("completed");
    expect(state.currentText).toBe("Hello world");
    expect(state.phaseStatus).toBe("Drafting response");
  });

  it("uses gemini fallback header when title is missing", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "init",
        session_id: "s2",
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "gemini",
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

    expect(text).toContain("*Gemini is running...*");
  });

  it("renders Gemini CLI errors as live status content", () => {
    const now = Date.now();
    const state = buildSessionMessageState([
      rawEvent(now, {
        type: "init",
        session_id: "s3",
      }),
      rawEvent(now + 1, {
        type: "error",
        error: {
          message: "Gemini CLI timed out",
        },
      }),
    ]);

    const text = buildStatusMessageByProvider(
      "gemini",
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

    expect(text).toContain("Gemini error: Gemini CLI timed out");
  });
});
