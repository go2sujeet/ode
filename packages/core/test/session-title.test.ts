import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { SessionMessageState } from "@/utils";
import { generateTitleFromPrompt, maybeGenerateSessionTitle } from "../runtime/session-title";

describe("session title generation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns normalized title when SiliconFlow succeeds", async () => {
    globalThis.fetch = ((async () => new Response(JSON.stringify({
      choices: [{ message: { content: '  "Fix   flaky tests"  ' } }],
    }), { status: 200 })) as unknown) as typeof fetch;

    const title = await generateTitleFromPrompt("make tests stable");
    expect(title).toBe("Fix flaky tests");
  });

  it("returns null when SiliconFlow returns non-200", async () => {
    globalThis.fetch = ((async () => new Response("rate limited", { status: 429 })) as unknown) as typeof fetch;

    const title = await generateTitleFromPrompt("some prompt");
    expect(title).toBeNull();
  });

  it("returns null when response payload has no message content", async () => {
    globalThis.fetch = ((async () => new Response(JSON.stringify({ choices: [{}] }), { status: 200 })) as unknown) as typeof fetch;

    const title = await generateTitleFromPrompt("some prompt");
    expect(title).toBeNull();
  });

  it("updates existing state title asynchronously", async () => {
    globalThis.fetch = ((async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Refactor auth middleware" } }],
    }), { status: 200 })) as unknown) as typeof fetch;

    const stateKey = "C1:T1:S1";
    const startedAt = Date.now() - 1000;
    const liveParsedState = new Map<string, SessionMessageState>([
      [
        stateKey,
        {
          currentText: "",
          tools: [],
          todos: [],
          startedAt,
        },
      ],
    ]);

    await maybeGenerateSessionTitle({
      prompt: "help me refactor auth middleware",
      getStateKey: () => stateKey,
      liveParsedState,
      startedAt,
    });

    expect(liveParsedState.get(stateKey)?.sessionTitle).toBe("Refactor auth middleware");
  });

  it("creates a title-only state when no state exists", async () => {
    globalThis.fetch = ((async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Add dashboard filters" } }],
    }), { status: 200 })) as unknown) as typeof fetch;

    const stateKey = "C2:T2:S2";
    const startedAt = Date.now() - 1000;
    const liveParsedState = new Map<string, SessionMessageState>();

    await maybeGenerateSessionTitle({
      prompt: "add filters to dashboard",
      getStateKey: () => stateKey,
      liveParsedState,
      startedAt,
    });

    const created = liveParsedState.get(stateKey);
    expect(created?.sessionTitle).toBe("Add dashboard filters");
    expect(created?.tools.length).toBe(0);
    expect(created?.todos.length).toBe(0);
  });

  it("follows a rotating state key when a status message swap happens mid-flight", async () => {
    globalThis.fetch = ((async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Investigate cron flakiness" } }],
    }), { status: 200 })) as unknown) as typeof fetch;

    const startedAt = Date.now() - 1000;
    const oldKey = "C3:T3:OLD";
    const newKey = "C3:T3:NEW";
    const liveParsedState = new Map<string, SessionMessageState>([
      [
        newKey,
        {
          currentText: "working",
          tools: [],
          todos: [],
          startedAt,
        },
      ],
    ]);

    let currentKey = oldKey;
    const promise = maybeGenerateSessionTitle({
      prompt: "investigate why cron job keeps failing",
      getStateKey: () => currentKey,
      liveParsedState,
      startedAt,
    });
    // Simulate a status-message rotation before the async title arrives.
    currentKey = newKey;

    await promise;

    expect(liveParsedState.get(newKey)?.sessionTitle).toBe("Investigate cron flakiness");
    expect(liveParsedState.has(oldKey)).toBe(false);
  });
});
