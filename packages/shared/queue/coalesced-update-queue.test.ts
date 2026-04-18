import { describe, expect, it } from "bun:test";
import { CoalescedUpdateQueue } from "@/shared/queue/coalesced-update-queue";

describe("CoalescedUpdateQueue", () => {
  it("coalesces same-key updates and keeps latest payload", async () => {
    const seen: string[] = [];
    const queue = new CoalescedUpdateQueue<string | undefined>(0, async (_key, payload) => {
      seen.push(payload);
      return payload;
    });

    const [a, b, c] = await Promise.all([
      queue.enqueue({ channelId: "C1", messageId: "M1" }, "one"),
      queue.enqueue({ channelId: "C1", messageId: "M1" }, "two"),
      queue.enqueue({ channelId: "C1", messageId: "M1" }, "three"),
    ]);

    expect(seen).toEqual(["three"]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(c).toBe("three");
  });

  it("serializes cross-key jobs", async () => {
    const seen: string[] = [];
    const queue = new CoalescedUpdateQueue<string>(1, async (key, payload) => {
      seen.push(`${key.messageId}:${payload}`);
      return payload;
    });

    await Promise.all([
      queue.enqueue({ channelId: "C1", messageId: "M1" }, "a"),
      queue.enqueue({ channelId: "C1", messageId: "M2" }, "b"),
    ]);

    expect(seen).toEqual(["M1:a", "M2:b"]);
  });

  it("does not leak unhandled rejections when clear() drops waiting jobs", async () => {
    // Reproduces ODE-DEAMON-5: Bottleneck rejects dropped jobs with
    // "This limiter has been stopped." and a subsequent clear() would
    // also reject with "stop() has already been called". Both must be
    // swallowed internally so they don't surface as unhandled rejections.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const queue = new CoalescedUpdateQueue<string | undefined>(50, async (_key, payload) => {
        // Simulate a slow worker so the job is still in the limiter's queue
        // when clear() drops it.
        await new Promise((resolve) => setTimeout(resolve, 25));
        return payload;
      });

      // First enqueue starts running; subsequent ones wait in the queue and
      // will be dropped by clear().
      const p1 = queue.enqueue({ channelId: "C1", messageId: "M1" }, "a");
      const p2 = queue.enqueue({ channelId: "C1", messageId: "M2" }, "b");
      const p3 = queue.enqueue({ channelId: "C1", messageId: "M3" }, "c");

      queue.clear();
      // Idempotent clear — must not re-throw "stop() has already been called".
      queue.clear();

      // All pending callers receive undefined instead of hanging.
      const results = await Promise.all([p1, p2, p3]);
      expect(results).toEqual([undefined, undefined, undefined]);

      // Let any async rejections settle before assertion.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
