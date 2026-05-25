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
  it("emits a plan_update for the initial phase title", () => {
    const differ = createStatusStreamDiffer();
    const { chunks, commit } = differ.diff({
      state: baseState(),
      workingPath: cwd,
      startedAt: Date.now(),
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: "plan_update", title: "Working" });
    commit();
  });

  it("emits nothing on a second diff when nothing changed (after commit)", () => {
    const differ = createStatusStreamDiffer();
    const first = differ.diff({ state: baseState(), workingPath: cwd, startedAt: 0 });
    first.commit();
    const second = differ.diff({ state: baseState(), workingPath: cwd, startedAt: 0 });
    expect(second.chunks).toHaveLength(0);
  });

  it("retries the same chunks on the next tick when commit() is skipped", () => {
    // Regression: a transient appendStream failure used to leave the
    // differ's fingerprint cache advanced anyway, so the next tick would
    // emit no chunks and the failed update was permanently lost.
    const differ = createStatusStreamDiffer();
    const first = differ.diff({ state: baseState(), workingPath: cwd, startedAt: 0 });
    expect(first.chunks).toHaveLength(1);
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
      expect(taskChunk.id).toBe("tool-1");
      expect(taskChunk.status).toBe("in_progress");
      expect(taskChunk.title).toContain("git status");
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
    const transition = chunks.find((c) => c.type === "task_update");
    expect(transition).toBeDefined();
    if (transition?.type === "task_update") {
      expect(transition.status).toBe("complete");
      expect(transition.output).toBe("3 files modified");
    }
  });

  it("emits a fresh plan_update when phaseStatus changes", () => {
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
    expect(chunks).toContainEqual({ type: "plan_update", title: "Running tool: bash" });
  });
});
