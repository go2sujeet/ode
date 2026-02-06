import { describe, expect, it } from "bun:test";
import { ThreadMessageQueue } from "../runtime/thread-queue";

type Ctx = { channelId: string; threadId: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ThreadMessageQueue", () => {
  it("batches multiple messages from the same thread", async () => {
    const calls: string[] = [];
    const queue = new ThreadMessageQueue<Ctx>({
      getKey: (ctx) => `${ctx.channelId}-${ctx.threadId}`,
      process: async (_ctx, text) => {
        calls.push(text);
      },
    });

    queue.enqueue({ channelId: "C1", threadId: "T1" }, "one");
    queue.enqueue({ channelId: "C1", threadId: "T1" }, "two");
    queue.enqueue({ channelId: "C1", threadId: "T1" }, "three");

    await sleep(20);

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.join("\n")).toBe("one\ntwo\nthree");
  });

  it("processes different thread keys independently", async () => {
    const calls: string[] = [];
    const queue = new ThreadMessageQueue<Ctx>({
      getKey: (ctx) => `${ctx.channelId}-${ctx.threadId}`,
      process: async (ctx, text) => {
        calls.push(`${ctx.threadId}:${text}`);
      },
    });

    queue.enqueue({ channelId: "C1", threadId: "T1" }, "a");
    queue.enqueue({ channelId: "C1", threadId: "T2" }, "b");

    await sleep(20);

    expect(new Set(calls)).toEqual(new Set(["T1:a", "T2:b"]));
  });

  it("runs a second pass when new items arrive while processing", async () => {
    const calls: string[] = [];
    const queue = new ThreadMessageQueue<Ctx>({
      getKey: (ctx) => `${ctx.channelId}-${ctx.threadId}`,
      process: async (ctx, text) => {
        calls.push(text);
        if (text === "first") {
          queue.enqueue(ctx, "second");
        }
      },
    });

    queue.enqueue({ channelId: "C1", threadId: "T1" }, "first");
    await sleep(20);

    expect(calls).toEqual(["first", "second"]);
  });
});
