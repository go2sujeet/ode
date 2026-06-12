import { describe, expect, it } from "bun:test";
import { createStatusStreamDiffer } from "../status-stream";
import type { SessionMessageState } from "../session-inspector";

function baseState(overrides: Partial<SessionMessageState> = {}): SessionMessageState {
  return {
    sessionTitle: "Test",
    phaseStatus: "Working",
    currentText: "",
    tools: [],
    todos: [],
    startedAt: Date.now(),
    ...overrides,
  };
}

const cwd = "/tmp/repo";

describe("createStatusStreamDiffer", () => {
  it("emits a plan_update plus complete-card rows for the initial status", () => {
    const differ = createStatusStreamDiffer();
    const { chunks, commit } = differ.diff({
      state: baseState(),
      workingPath: cwd,
      startedAt: Date.now(),
    });
    expect(chunks).toHaveLength(5);
    expect(chunks[0]).toMatchObject({ type: "plan_update" });
    expect(chunks[0]?.type === "plan_update" ? chunks[0].title : "").toMatch(/^Test · \d+s$/);
    expect(chunks[1]).toMatchObject({
      type: "task_update",
      id: "meta:context",
      title: "Run context",
      status: "complete",
      details: "build mode",
      output: cwd,
    });
    expect(chunks[2]).toMatchObject({
      type: "task_update",
      id: "meta:phase",
      title: "Current status",
      status: "in_progress",
    });
    expect(chunks[3]).toMatchObject({
      type: "task_update",
      id: "group:tasks",
      title: "Tasks",
    });
    expect(chunks[4]).toMatchObject({
      type: "task_update",
      id: "group:tools",
      title: "Tool calling",
    });
    commit();
  });

  it("emits nothing on a second diff when nothing changed (after commit)", () => {
    const differ = createStatusStreamDiffer();
    const first = differ.diff({ state: baseState(), workingPath: cwd, startedAt: 0 });
    first.commit();
    const second = differ.diff({ state: baseState(), workingPath: cwd, startedAt: 0 });
    expect(second.chunks).toHaveLength(0);
  });

  it("shows the requested run mode in the Run context row", () => {
    const differ = createStatusStreamDiffer();
    const { chunks } = differ.diff({
      state: baseState(),
      workingPath: cwd,
      startedAt: 0,
      agentLabel: "OpenCode",
      runMode: "plan mode",
    });
    const contextChunk = chunks.find((chunk) => chunk.type === "task_update" && chunk.id === "meta:context");
    expect(contextChunk).toMatchObject({
      type: "task_update",
      id: "meta:context",
      title: "Run context",
      details: "OpenCode · plan mode",
      output: cwd,
    });
  });

  it("retries the same chunks on the next tick when commit() is skipped", () => {
    // Regression: a transient appendStream failure used to leave the
    // differ's fingerprint cache advanced anyway, so the next tick would
    // emit no chunks and the failed update was permanently lost.
    const differ = createStatusStreamDiffer();
    const first = differ.diff({ state: baseState(), workingPath: cwd, startedAt: 0 });
    expect(first.chunks).toHaveLength(5);
    // Simulate appendStream throwing — caller does NOT invoke commit().
    const second = differ.diff({ state: baseState(), workingPath: cwd, startedAt: 0 });
    expect(second.chunks).toEqual(first.chunks);
  });

  it("emits a task_update when a tool appears, then nothing when unchanged", () => {
    const differ = createStatusStreamDiffer();
    const state = baseState({
      tools: [{
        id: "tool-1",
        name: "bash",
        status: "running",
        input: { command: "git status" },
      }],
    });
    const first = differ.diff({ state, workingPath: cwd, startedAt: 0 });
    first.commit();
    const taskChunk = first.chunks.find((c) => c.type === "task_update");
    expect(taskChunk).toBeDefined();
    if (taskChunk?.type === "task_update") {
      expect(taskChunk.id).toBe("meta:context");
    }
    const toolChunk = first.chunks.find((c) => c.type === "task_update" && c.id === "group:tools");
    expect(toolChunk).toBeDefined();
    if (toolChunk?.type === "task_update") {
      expect(toolChunk.status).toBe("in_progress");
      expect(toolChunk.title).toBe("Tool calling");
      expect(toolChunk.details).toContain("git status");
    }

    const second = differ.diff({ state, workingPath: cwd, startedAt: 0 });
    expect(second.chunks).toHaveLength(0);
  });

  it("emits a follow-up task_update when a tool transitions to complete", () => {
    const differ = createStatusStreamDiffer();
    const running = baseState({
      tools: [{
        id: "tool-1",
        name: "bash",
        status: "running",
        input: { command: "git status" },
      }],
    });
    const completed = baseState({
      tools: [{
        id: "tool-1",
        name: "bash",
        status: "completed",
        input: { command: "git status" },
        output: "3 files modified",
      }],
    });
    differ.diff({ state: running, workingPath: cwd, startedAt: 0 }).commit();
    const { chunks, commit } = differ.diff({
      state: completed,
      workingPath: cwd,
      startedAt: 0,
    });
    commit();
    const transition = chunks.find((c) => c.type === "task_update" && c.id === "group:tools");
    expect(transition).toBeDefined();
    if (transition?.type === "task_update") {
      expect(transition.status).toBe("complete");
      expect(transition.output).toBeUndefined();
      expect(transition.details).toContain("git status");
    }
  });

  it("keeps tool-specific phases in the phase row instead of the plan title", () => {
    const differ = createStatusStreamDiffer();
    differ.diff({
      state: baseState({ phaseStatus: "Working" }),
      workingPath: cwd,
      startedAt: 0,
    }).commit();
    const { chunks, commit } = differ.diff({
      state: baseState({ phaseStatus: "Running tool: bash" }),
      workingPath: cwd,
      startedAt: 0,
    });
    commit();
    expect(chunks).not.toContainEqual({ type: "plan_update", title: "Running tool: bash" });
    expect(chunks).toContainEqual({ type: "task_update", id: "meta:phase", title: "Current status", status: "in_progress", details: "Running tool: bash" });
  });

  it("does not render cumulative assistant draft text as the current status", () => {
    const differ = createStatusStreamDiffer();
    const { chunks } = differ.diff({
      state: baseState({
        phaseStatus: "Working",
        currentText: "Working: first update. Working: second update. Working: third update.",
      }),
      workingPath: cwd,
      startedAt: 0,
    });

    const phaseChunk = chunks.find((chunk) => chunk.type === "task_update" && chunk.id === "meta:phase");
    expect(phaseChunk).toMatchObject({
      type: "task_update",
      id: "meta:phase",
      title: "Current status",
      status: "in_progress",
      details: "Working",
    });
  });

  it("renders todos ahead of recent tool slots", () => {
    const differ = createStatusStreamDiffer();
    const { chunks } = differ.diff({
      state: baseState({
        todos: [
          { content: "Inspect current implementation", status: "completed" },
          { content: "Patch Slack stream layout", status: "in_progress" },
        ],
        tools: [{
          id: "tool-1",
          name: "bash",
          status: "running",
          input: { command: "bun test" },
        }],
      }),
      workingPath: cwd,
      startedAt: 0,
    });

    const taskIds = chunks
      .filter((chunk) => chunk.type === "task_update")
      .map((chunk) => chunk.id);
    expect(taskIds).toEqual(["meta:context", "meta:phase", "group:tasks", "group:tools"]);
    const taskChunk = chunks.find((chunk) => chunk.type === "task_update" && chunk.id === "group:tasks");
    expect(taskChunk?.type === "task_update" ? taskChunk.details : "").toContain("Inspect current implementation");
    expect(taskChunk?.type === "task_update" ? taskChunk.details : "").toContain("Patch Slack stream layout");
  });

  it("keeps recent tools grouped in one stable row instead of appending raw tool ids forever", () => {
    const differ = createStatusStreamDiffer();
    const makeTools = (count: number) => Array.from({ length: count }, (_, index) => ({
      id: `tool-${index + 1}`,
      name: "bash",
      status: "completed",
      input: { command: `echo ${index + 1}` },
      output: `done ${index + 1}`,
    }));

    const first = differ.diff({
      state: baseState({ tools: makeTools(6) }),
      workingPath: cwd,
      startedAt: 0,
    });
    first.commit();
    const firstToolIds = first.chunks
      .filter((chunk) => chunk.type === "task_update")
      .filter((chunk) => chunk.id === "group:tools")
      .map((chunk) => chunk.id);
    expect(firstToolIds).toEqual(["group:tools"]);
    const firstToolChunk = first.chunks.find((chunk) => chunk.type === "task_update" && chunk.id === "group:tools");
    const firstDetails = firstToolChunk?.type === "task_update" ? firstToolChunk.details ?? "" : "";
    expect(firstDetails).not.toContain("previous");
    expect(firstDetails).toContain("echo 1");
    expect(firstDetails).toContain("echo 6");

    const second = differ.diff({
      state: baseState({ tools: makeTools(7) }),
      workingPath: cwd,
      startedAt: 0,
    });
    const secondToolIds = second.chunks
      .filter((chunk) => chunk.type === "task_update")
      .filter((chunk) => chunk.id === "group:tools")
      .map((chunk) => chunk.id);
    expect(secondToolIds).toEqual(["group:tools"]);
    const secondToolChunk = second.chunks.find((chunk) => chunk.type === "task_update" && chunk.id === "group:tools");
    const secondDetails = secondToolChunk?.type === "task_update" ? secondToolChunk.details ?? "" : "";
    expect(secondDetails).toContain("- done: previous 1 tool calls completed");
    expect(secondDetails).not.toContain("echo 1");
    expect(secondDetails).toContain("echo 2");
    expect(secondDetails).toContain("echo 7");
  });

  it("uses the configured live-status format limit for Slack AI Card tool rows", () => {
    const makeTools = (count: number) => Array.from({ length: count }, (_, index) => ({
      id: `tool-${index + 1}`,
      name: "bash",
      status: "completed",
      input: { command: `echo ${index + 1}` },
    }));

    const minimum = createStatusStreamDiffer().diff({
      state: baseState({ tools: makeTools(6) }),
      workingPath: cwd,
      startedAt: 0,
      statusMessageFormat: "minimum",
    });
    const minimumToolChunk = minimum.chunks.find((chunk) => chunk.type === "task_update" && chunk.id === "group:tools");
    const minimumDetails = minimumToolChunk?.type === "task_update" ? minimumToolChunk.details ?? "" : "";
    expect(minimumDetails).toContain("- done: previous 2 tool calls completed");
    expect(minimumDetails).not.toContain("echo 1");
    expect(minimumDetails).not.toContain("echo 2");
    expect(minimumDetails).toContain("echo 3");
    expect(minimumDetails).toContain("echo 6");

    const aggressive = createStatusStreamDiffer().diff({
      state: baseState({ tools: makeTools(9) }),
      workingPath: cwd,
      startedAt: 0,
      statusMessageFormat: "aggressive",
    });
    const aggressiveToolChunk = aggressive.chunks.find((chunk) => chunk.type === "task_update" && chunk.id === "group:tools");
    const aggressiveDetails = aggressiveToolChunk?.type === "task_update" ? aggressiveToolChunk.details ?? "" : "";
    expect(aggressiveDetails).toContain("- done: previous 1 tool calls completed");
    expect(aggressiveDetails).not.toContain("echo 1");
    expect(aggressiveDetails).toContain("echo 2");
    expect(aggressiveDetails).toContain("echo 9");
  });

  it("builds a plain-text final title for Slack plan_update chunks", () => {
    const differ = createStatusStreamDiffer();
    const title = differ.finalize({
      state: baseState({
        sessionTitle: "Claude Code",
        tokenUsage: { input: 2600, output: 3000, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 5600 },
      }),
      workingPath: cwd,
      startedAt: Date.now() - 75_000,
    });

    expect(title).toStartWith("Claude Code · Done in ");
    expect(title).toContain("5.6k tokens");
    expect(title).not.toContain("*");
  });

  it("puts a final result preview in the collapsed Slack card title", () => {
    const differ = createStatusStreamDiffer();
    const title = differ.finalize({
      state: baseState({
        sessionTitle: "Claude Code",
        tokenUsage: { input: 12_000, output: 4_400, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 16_400 },
      }),
      workingPath: cwd,
      startedAt: Date.now() - 180_000,
    }, "### Result\n\n`sample-project` checked successfully. This is a deliberately long result preview that should be shortened before it reaches Slack.");

    expect(title).toStartWith("Claude Code · Result: Result sample-project checked successfully.");
    expect(title).toContain("Done in ");
    expect(title).toContain("16k tokens");
    expect(title).not.toContain("`");
    expect(title).not.toContain("#");
  });
});
