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
});
