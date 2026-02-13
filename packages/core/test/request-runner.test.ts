import { describe, expect, it } from "bun:test";
import { CoreStateMachine } from "../state-machine";
import { runTrackedRequest } from "../runtime/request-runner";
import type { ActiveRequest } from "@/config/local/sessions";

function buildRequest(): ActiveRequest {
  const now = Date.now();
  return {
    sessionId: "s1",
    replyThreadId: "T1",
    channelId: "C1",
    threadId: "T1",
    statusMessageTs: "100.2",
    prompt: "hello",
    startedAt: now,
    lastUpdatedAt: now,
    currentText: "",
    tools: [],
    todos: [],
    state: "processing",
  };
}

describe("runTrackedRequest", () => {
  it("publishes final text on success", async () => {
    const published: string[] = [];
    const completed: string[] = [];

    const result = await runTrackedRequest({
      deps: {
        agent: {
          supportsEventStream: false,
        } as any,
        im: {
          updateMessage: async () => {},
        } as any,
      },
      request: buildRequest(),
      statusTs: "100.2",
      workingPath: "/tmp/project",
      stateMachine: new CoreStateMachine("C1:T1"),
      liveEventHistory: new Map(),
      liveParsedState: new Map(),
      sendPrompt: async () => [{ text: "done", messageType: "assistant" }],
      onProgressTick: async () => {},
      onComplete: () => completed.push("ok"),
      onFail: () => {},
      publishFinalText: async (text) => {
        published.push(text);
      },
      failureLogLabel: "runner failed",
    });

    expect(result.responses?.length).toBe(1);
    expect(completed.length).toBe(1);
    expect(published).toEqual(["done"]);
  });

  it("reports failure and updates status", async () => {
    const failures: string[] = [];
    const statusUpdates: string[] = [];

    const result = await runTrackedRequest({
      deps: {
        agent: {
          supportsEventStream: false,
        } as any,
        im: {
          updateMessage: async (_channelId: string, _ts: string, text: string) => {
            statusUpdates.push(text);
          },
        } as any,
      },
      request: buildRequest(),
      statusTs: "100.2",
      workingPath: "/tmp/project",
      stateMachine: new CoreStateMachine("C1:T1"),
      liveEventHistory: new Map(),
      liveParsedState: new Map(),
      sendPrompt: async () => {
        throw new Error("boom");
      },
      onProgressTick: async () => {},
      onComplete: () => {},
      onFail: (message) => failures.push(message),
      publishFinalText: async () => {},
      failureLogLabel: "runner failed",
    });

    expect(result.responses).toBeNull();
    expect(failures.length).toBe(1);
    expect(statusUpdates.length).toBe(1);
    expect(statusUpdates[0]).toContain("Error:");
  });
});
