import { describe, expect, it } from "bun:test";
import { SlackMessageUpdateManager } from "@/ims/slack/message-update-manager";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SlackMessageUpdateManager", () => {
  it("coalesces updates across callers for the same message", async () => {
    const calls: string[] = [];
    const manager = new SlackMessageUpdateManager(async ({ text }) => {
      calls.push(text);
      await sleep(10);
    });

    const first = manager.updateMessage({ channelId: "C1", messageTs: "1", text: "first", processorId: "p1" });
    const second = manager.updateMessage({ channelId: "C1", messageTs: "1", text: "second", processorId: "p2" });

    await Promise.all([first, second]);

    expect(calls).toEqual(["second"]);
  });

  it("drops pending and future updates after finalization", async () => {
    const calls: string[] = [];
    const control: { release?: () => void; started?: () => void } = {};
    const startedSignal = new Promise<void>((resolve) => {
      control.started = resolve;
    });
    const manager = new SlackMessageUpdateManager(async ({ text }) => {
      calls.push(text);
      if (text === "live") {
        control.started?.();
        await new Promise<void>((resolve) => {
          control.release = resolve;
        });
      }
    });

    const live = manager.updateMessage({ channelId: "C2", messageTs: "2", text: "live", processorId: "p1" });
    // Wait deterministically for the "live" worker to be mid-flight (post-push,
    // pre-release) instead of relying on a short sleep, which is flaky on slow
    // CI runners.
    await startedSignal;
    const stale = manager.updateMessage({ channelId: "C2", messageTs: "2", text: "stale", processorId: "p2" });
    manager.markMessageFinalized("C2", "2");
    if (control.release) {
      control.release();
    }

    await Promise.all([live, stale]);
    await manager.updateMessage({ channelId: "C2", messageTs: "2", text: "after-final", processorId: "p3" });

    expect(calls).toEqual(["live"]);
  });
});
