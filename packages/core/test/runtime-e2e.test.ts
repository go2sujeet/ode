import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createCoreRuntime } from "@/core/runtime";
import {
  deleteSession,
  saveSession,
  setPendingQuestion,
  type PendingQuestion,
} from "@/config/local/sessions";
import type { AgentAdapter, IMAdapter } from "@/core/types";
import type { RawInboundEvent } from "@/core/model/raw-inbound-event";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let sequence = 0;

function uniqueId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${sequence}`;
}

async function waitFor(check: () => boolean, timeoutMs = 1500): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await sleep(10);
  }
}

function createFakeIm(logs: {
  sends: Array<{ channelId: string; threadId: string; text: string }>;
  updates: Array<{ channelId: string; messageTs: string; text: string }>;
}): IMAdapter {
  let nextTs = 0;
  return {
    sendMessage: async (channelId, threadId, text) => {
      logs.sends.push({ channelId, threadId, text });
      nextTs += 1;
      return `ts-${nextTs}`;
    },
    updateMessage: async (channelId, messageTs, text) => {
      logs.updates.push({ channelId, messageTs, text });
    },
    deleteMessage: async () => {},
    fetchThreadHistory: async () => null,
    buildAgentContext: async () => ({ slack: { channelId: "C", threadId: "T", userId: "U" } }),
  };
}

function createFakeAgent(params?: {
  onSend?: (message: string) => Promise<void> | void;
  responses?: Array<{ text: string; messageType: "assistant" }>;
}) {
  const sentPrompts: string[] = [];
  const replyCalls: Array<Array<Array<string>>> = [];

  const agent: AgentAdapter = {
    supportsEventStream: false,
    getProviderForSession: () => "opencode",
    getDisplayNameForSession: () => "FakeAgent",
    getOrCreateSession: async () => ({ sessionId: "session-e2e", created: true }),
    sendMessage: async (_channelId, _sessionId, message) => {
      sentPrompts.push(message);
      await params?.onSend?.(message);
      return params?.responses ?? [{ text: "Hello from fake agent", messageType: "assistant" }];
    },
    abortSession: async () => {},
    ensureSession: async () => {},
    subscribeToSession: () => () => {},
    replyToQuestion: async ({ answers }) => {
      replyCalls.push(answers);
    },
    normalizeQuestions: () => [],
  };

  return { agent, sentPrompts, replyCalls };
}

async function withEnv<T>(name: string, value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

describe("core runtime e2e", () => {
  const previousCi = process.env.CI;

  beforeAll(() => {
    process.env.CI = "1";
  });

  afterAll(() => {
    if (previousCi === undefined) {
      delete process.env.CI;
      return;
    }
    process.env.CI = previousCi;
  });

  it("handles a full incoming flow and deduplicates duplicate message ids", async () => {
    const logs = { sends: [], updates: [] } as {
      sends: Array<{ channelId: string; threadId: string; text: string }>;
      updates: Array<{ channelId: string; messageTs: string; text: string }>;
    };
    const im = createFakeIm(logs);
    const { agent, sentPrompts } = createFakeAgent();

    const runtime = createCoreRuntime({ platform: "slack", im, agent });
    const channelId = uniqueId("CE2E-DEDUP");
    const threadId = uniqueId("TE2E-DEDUP");
    const context = {
      channelId,
      replyThreadId: threadId,
      threadId,
      userId: "UE2E-1",
      messageId: uniqueId("ME2E"),
    };

    await runtime.handleIncomingMessage(context, "hello runtime");
    await runtime.handleIncomingMessage(context, "hello runtime duplicate");

    await waitFor(() => sentPrompts.length === 1);
    await waitFor(() => logs.updates.some((entry) => entry.text.includes("Hello from fake agent")));

    expect(sentPrompts).toEqual(["hello runtime"]);
    expect(logs.sends.some((entry) => entry.text.includes("is running"))).toBe(true);
    expect(logs.updates.some((entry) => entry.text.includes("Hello from fake agent"))).toBe(true);

    deleteSession(context.channelId, context.threadId);
  });

  it("preserves processing order for multiple queued messages in same thread", async () => {
    const logs = { sends: [], updates: [] } as {
      sends: Array<{ channelId: string; threadId: string; text: string }>;
      updates: Array<{ channelId: string; messageTs: string; text: string }>;
    };
    const im = createFakeIm(logs);
    const processingOrder: string[] = [];
    const { agent, sentPrompts } = createFakeAgent({
      onSend: async (message) => {
        processingOrder.push(message);
        if (message === "first") {
          await sleep(40);
        }
      },
      responses: [{ text: "ok", messageType: "assistant" }],
    });
    const runtime = createCoreRuntime({ platform: "slack", im, agent });
    const channelId = uniqueId("CE2E-QUEUE");
    const threadId = uniqueId("TE2E-QUEUE");

    const baseContext = {
      channelId,
      replyThreadId: threadId,
      threadId,
      userId: "UE2E-2",
    };

    await runtime.handleIncomingMessage({ ...baseContext, messageId: uniqueId("ME2E-Q1") }, "first");
    await runtime.handleIncomingMessage({ ...baseContext, messageId: uniqueId("ME2E-Q2") }, "second");

    await waitFor(() => sentPrompts.length === 2);

    expect(processingOrder).toEqual(["first", "second"]);
    expect(sentPrompts).toEqual(["first", "second"]);

    deleteSession(baseContext.channelId, baseContext.threadId);
  });

  it("routes pending-question replies instead of opening a new request", async () => {
    const logs = { sends: [], updates: [] } as {
      sends: Array<{ channelId: string; threadId: string; text: string }>;
      updates: Array<{ channelId: string; messageTs: string; text: string }>;
    };
    const im = createFakeIm(logs);
    const { agent, sentPrompts, replyCalls } = createFakeAgent();

    const channelId = uniqueId("CE2E-PQ");
    const threadId = uniqueId("TE2E-PQ");
    const ownerUserId = "UE2E-owner";
    const pending: PendingQuestion = {
      requestId: "rq-e2e-1",
      sessionId: "session-e2e-pq",
      askedAt: Date.now(),
      questions: [{ question: "Q1" }, { question: "Q2" }],
    };

    saveSession({
      sessionId: "session-e2e-pq",
      providerId: "opencode",
      platform: "slack",
      channelId,
      threadId,
      workingDirectory: "/tmp",
      threadOwnerUserId: ownerUserId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      pendingQuestion: pending,
    });
    setPendingQuestion(channelId, threadId, pending);

    const runtime = createCoreRuntime({ platform: "slack", im, agent });
    await runtime.handleIncomingMessage(
      {
        channelId,
        replyThreadId: threadId,
        threadId,
        userId: ownerUserId,
        messageId: uniqueId("ME2E-PQ"),
      },
      "first\nsecond"
    );

    await waitFor(() => replyCalls.length === 1);

    expect(replyCalls[0]).toEqual([["first"], ["second"]]);
    expect(sentPrompts.length).toBe(0);

    deleteSession(channelId, threadId);
  });

  it("keeps dispatch parity for Discord between legacy and inbound-event paths", async () => {
    const legacyLogs = { sends: [], updates: [] } as {
      sends: Array<{ channelId: string; threadId: string; text: string }>;
      updates: Array<{ channelId: string; messageTs: string; text: string }>;
    };
    const kernelLogs = { sends: [], updates: [] } as {
      sends: Array<{ channelId: string; threadId: string; text: string }>;
      updates: Array<{ channelId: string; messageTs: string; text: string }>;
    };
    const legacyIm = createFakeIm(legacyLogs);
    const kernelIm = createFakeIm(kernelLogs);
    const legacyAgent = createFakeAgent();
    const kernelAgent = createFakeAgent();

    await withEnv("LEGACY_INBOUND_PATH", "1", async () => {
      const runtime = createCoreRuntime({ platform: "discord", im: legacyIm, agent: legacyAgent.agent });
      const channelId = uniqueId("CE2E-DIS-LEGACY");
      const threadId = uniqueId("TE2E-DIS-LEGACY");
      await runtime.handleIncomingMessage({
        channelId,
        rawChannelId: channelId,
        replyThreadId: threadId,
        threadId,
        userId: "UE2E-dis",
        messageId: uniqueId("ME2E-dis-legacy"),
        botToken: "bot-1",
      }, "hello discord");
      await waitFor(() => legacyAgent.sentPrompts.length === 1);
      deleteSession(channelId, threadId);
    });

    await withEnv("LEGACY_INBOUND_PATH", undefined, async () => {
      const runtime = createCoreRuntime({ platform: "discord", im: kernelIm, agent: kernelAgent.agent });
      const channelId = uniqueId("CE2E-DIS-KERNEL");
      const threadId = uniqueId("TE2E-DIS-KERNEL");
      const event: RawInboundEvent = {
        platform: "discord",
        botId: "bot-1",
        channelId,
        rawChannelId: channelId,
        threadId,
        replyThreadId: threadId,
        messageId: uniqueId("ME2E-dis-kernel"),
        userId: "UE2E-dis",
        isTopLevel: false,
        mentionedBot: true,
        activeThread: true,
        rawText: "hello discord",
        normalizedText: "hello discord",
        receivedAtMs: Date.now(),
      };
      await runtime.handleInboundEvent(event);
      await waitFor(() => kernelAgent.sentPrompts.length === 1);
      deleteSession(channelId, threadId);
    });

    expect(legacyAgent.sentPrompts).toEqual(["hello discord"]);
    expect(kernelAgent.sentPrompts).toEqual(["hello discord"]);
  });

  it("keeps dispatch parity for Lark and ignores unmentioned top-level messages", async () => {
    const logs = { sends: [], updates: [] } as {
      sends: Array<{ channelId: string; threadId: string; text: string }>;
      updates: Array<{ channelId: string; messageTs: string; text: string }>;
    };
    const im = createFakeIm(logs);
    const { agent, sentPrompts } = createFakeAgent();

    await withEnv("LEGACY_INBOUND_PATH", undefined, async () => {
      const runtime = createCoreRuntime({ platform: "lark", im, agent });
      const channelId = uniqueId("CE2E-LARK");
      const threadId = uniqueId("TE2E-LARK");

      await runtime.handleInboundEvent({
        platform: "lark",
        botId: "bot-lark",
        channelId,
        rawChannelId: channelId,
        threadId,
        replyThreadId: threadId,
        messageId: uniqueId("ME2E-lark-ignore"),
        userId: "UE2E-lark",
        isTopLevel: true,
        mentionedBot: false,
        activeThread: false,
        rawText: "random text",
        normalizedText: "random text",
        receivedAtMs: Date.now(),
      });

      await runtime.handleInboundEvent({
        platform: "lark",
        botId: "bot-lark",
        channelId,
        rawChannelId: channelId,
        threadId,
        replyThreadId: threadId,
        messageId: uniqueId("ME2E-lark-forward"),
        userId: "UE2E-lark",
        isTopLevel: false,
        mentionedBot: true,
        activeThread: true,
        rawText: "hello lark",
        normalizedText: "hello lark",
        receivedAtMs: Date.now(),
      });

      await waitFor(() => sentPrompts.length === 1);
      deleteSession(channelId, threadId);
    });

    expect(sentPrompts).toEqual(["hello lark"]);
  });
});
