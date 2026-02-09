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
});
