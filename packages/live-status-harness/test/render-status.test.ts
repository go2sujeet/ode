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
    expect(joined).toContain("Opencode is running...");
    expect(joined).toContain("Finished tool: Read");
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
    expect(joined).toContain("Opencode is running...");
    expect(joined).toContain("Running tool: read_file");
  });
});
