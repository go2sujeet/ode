import { describe, expect, it } from "bun:test";
import { renderStatusesFromRun } from "../renderer";
import type { HarnessCapturedEvent, HarnessRunMeta } from "../types";

type FixtureShape = {
  meta: HarnessRunMeta;
  events: HarnessCapturedEvent[];
};

describe("live status harness renderer", () => {
  it("renders deterministic incremental statuses from captured events", async () => {
    const fixtureFile = Bun.file(`${import.meta.dir}/fixtures/claude-basic-run.json`);
    const fixture = JSON.parse(await fixtureFile.text()) as FixtureShape;

    const statuses = renderStatusesFromRun(fixture.meta, fixture.events);

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses[0]?.text).toContain("Running tool: Read");
    expect(statuses[statuses.length - 1]?.text).toContain("Finished tool: Read");
    expect(statuses.some((status) => status.text.includes("Drafting response"))).toBeTrue();
  });

  it("renders codex tool and response statuses from fixture", async () => {
    const fixtureFile = Bun.file(`${import.meta.dir}/fixtures/codex-basic-run.json`);
    const fixture = JSON.parse(await fixtureFile.text()) as FixtureShape;

    const statuses = renderStatusesFromRun(fixture.meta, fixture.events);
    const joined = statuses.map((status) => status.text).join("\n\n");

    expect(statuses.length).toBeGreaterThanOrEqual(4);
    expect(joined).toContain("Running tool: Bash");
    expect(joined).toContain("Finished tool: Bash");
    expect(joined).toContain("Drafting response");
  });

  it("renders kiro busy to idle live status from fixture", async () => {
    const fixtureFile = Bun.file(`${import.meta.dir}/fixtures/kiro-basic-run.json`);
    const fixture = JSON.parse(await fixtureFile.text()) as FixtureShape;

    const statuses = renderStatusesFromRun(fixture.meta, fixture.events);
    const joined = statuses.map((status) => status.text).join("\n\n");

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(joined).toContain("Working");
    expect(joined).toContain("Waiting");
  });

  it("renders kilo live status from fixture", async () => {
    const fixtureFile = Bun.file(`${import.meta.dir}/fixtures/kilo-basic-run.json`);
    const fixture = JSON.parse(await fixtureFile.text()) as FixtureShape;

    const statuses = renderStatusesFromRun(fixture.meta, fixture.events);
    const joined = statuses.map((status) => status.text).join("\n\n");

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(joined).toContain("Working");
    expect(joined).toContain("Waiting");
  });

  it("renders goose live status from fixture", async () => {
    const fixtureFile = Bun.file(`${import.meta.dir}/fixtures/goose-basic-run.json`);
    const fixture = JSON.parse(await fixtureFile.text()) as FixtureShape;

    const statuses = renderStatusesFromRun(fixture.meta, fixture.events);
    const joined = statuses.map((status) => status.text).join("\n\n");

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(joined).toContain("Goose is running...");
    expect(joined).toContain("Finished tool: Read");
  });

  it("renders goose subagent completion when tool response uses tool_use_id", () => {
    const now = Date.now();
    const meta: HarnessRunMeta = {
      runId: "run-goose-subagent-id",
      provider: "goose",
      prompt: "test",
      promptHash: "hash",
      cwd: "/tmp/repo",
      channelId: "C1",
      threadId: "T1",
      sessionId: "goose_s1",
      startedAt: now,
      eventCount: 2,
    };

    const events: HarnessCapturedEvent[] = [
      {
        runId: "run-goose-subagent-id",
        sessionId: "goose_s1",
        provider: "goose",
        timestamp: now,
        index: 0,
        event: {
          type: "goose.raw.message",
          properties: {
            record: {
              type: "message",
              message: {
                role: "assistant",
                content: [
                  {
                    type: "toolRequest",
                    id: "call-subagent-1",
                    toolCall: {
                      value: {
                        name: "subagent",
                        arguments: { instructions: "inspect repo" },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      {
        runId: "run-goose-subagent-id",
        sessionId: "goose_s1",
        provider: "goose",
        timestamp: now + 1,
        index: 1,
        event: {
          type: "goose.raw.message",
          properties: {
            record: {
              type: "message",
              message: {
                role: "user",
                content: [
                  {
                    type: "toolResponse",
                    tool_use_id: "call-subagent-1",
                    toolResult: {
                      status: "success",
                      value: {
                        content: [
                          { type: "text", text: "subagent complete" },
                        ],
                        isError: false,
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ];

    const statuses = renderStatusesFromRun(meta, events);
    const joined = statuses.map((status) => status.text).join("\n\n");

    expect(joined).toContain("Running tool: subagent");
    expect(joined).toContain("Finished tool: subagent");
  });

  it("renders gemini live status from synthetic fixture", () => {
    const now = Date.now();
    const meta: HarnessRunMeta = {
      runId: "run-gemini-test",
      provider: "gemini",
      prompt: "test",
      promptHash: "hash",
      cwd: "/tmp/repo",
      channelId: "C1",
      threadId: "T1",
      sessionId: "gemini_s1",
      startedAt: now,
      eventCount: 3,
    };
    const events: HarnessCapturedEvent[] = [
      {
        runId: "run-gemini-test",
        sessionId: "gemini_s1",
        provider: "gemini",
        timestamp: now,
        index: 0,
        event: { type: "gemini.raw.init", properties: { record: { type: "init" } } },
      },
      {
        runId: "run-gemini-test",
        sessionId: "gemini_s1",
        provider: "gemini",
        timestamp: now + 1,
        index: 1,
        event: {
          type: "gemini.raw.tool_use",
          properties: { record: { type: "tool_use", tool_name: "read_file", tool_id: "tool-1" } },
        },
      },
      {
        runId: "run-gemini-test",
        sessionId: "gemini_s1",
        provider: "gemini",
        timestamp: now + 2,
        index: 2,
        event: {
          type: "gemini.raw.message",
          properties: { record: { type: "message", role: "assistant", content: "Done", delta: true } },
        },
      },
    ];

    const statuses = renderStatusesFromRun(meta, events);
    const joined = statuses.map((status) => status.text).join("\n\n");

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(joined).toContain("Gemini is running...");
    expect(joined).toContain("Running tool: read_file");
  });

  it("renders todos and waiting status from wrapped payload events", () => {
    const now = Date.now();
    const meta: HarnessRunMeta = {
      runId: "run-qwen-todo-test",
      provider: "qwen",
      prompt: "test",
      promptHash: "hash",
      cwd: "/tmp/repo",
      channelId: "C1",
      threadId: "T1",
      sessionId: "qwen_s1",
      startedAt: now,
      eventCount: 4,
    };

    const events: HarnessCapturedEvent[] = [
      {
        runId: "run-qwen-todo-test",
        sessionId: "qwen_s1",
        provider: "qwen",
        timestamp: now,
        index: 0,
        event: {
          payload: {
            type: "session.status",
            properties: {
              status: { type: "busy" },
            },
          },
        },
      },
      {
        runId: "run-qwen-todo-test",
        sessionId: "qwen_s1",
        provider: "qwen",
        timestamp: now + 1,
        index: 1,
        event: {
          payload: {
            type: "qwen.raw.stream_event",
            properties: {
              record: {
                type: "stream_event",
                event: {
                  type: "content_block_start",
                  index: 0,
                  content_block: {
                    type: "tool_use",
                    id: "todo-1",
                    name: "todo_write",
                  },
                },
              },
            },
          },
        },
      },
      {
        runId: "run-qwen-todo-test",
        sessionId: "qwen_s1",
        provider: "qwen",
        timestamp: now + 2,
        index: 2,
        event: {
          payload: {
            type: "qwen.raw.stream_event",
            properties: {
              record: {
                type: "stream_event",
                event: {
                  type: "content_block_delta",
                  index: 0,
                  delta: {
                    type: "input_json_delta",
                    partial_json: '{"todos":[{"content":"Verify harness parser","status":"in progress"}]}',
                  },
                },
              },
            },
          },
        },
      },
      {
        runId: "run-qwen-todo-test",
        sessionId: "qwen_s1",
        provider: "qwen",
        timestamp: now + 3,
        index: 3,
        event: {
          payload: {
            type: "session.status",
            properties: {
              status: { type: "idle" },
            },
          },
        },
      },
    ];

    const statuses = renderStatusesFromRun(meta, events);
    const finalText = statuses[statuses.length - 1]?.text || "";

    expect(finalText).toContain("*Tasks*");
    expect(finalText).toContain("`in progress` Verify harness parser");
    expect(finalText).toContain("_Waiting_");
  });
});
