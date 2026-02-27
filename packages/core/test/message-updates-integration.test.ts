import { describe, expect, it } from "bun:test";
import { createRateLimitedImAdapter } from "@/core/runtime/message-updates";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("createRateLimitedImAdapter integration", () => {
  it("coalesces repeated updates for the same message", async () => {
    const calls: Array<{ channelId: string; messageTs: string; text: string }> = [];
    const adapter = createRateLimitedImAdapter({
      sendMessage: async () => "m1",
      updateMessage: async (channelId: string, messageTs: string, text: string) => {
        calls.push({ channelId, messageTs, text });
      },
      deleteMessage: async () => {},
      fetchThreadHistory: async () => null,
      buildAgentContext: async () => ({}),
    }, 0);

    await Promise.all([
      adapter.updateMessage("C1", "100.1", "first"),
      adapter.updateMessage("C1", "100.1", "second"),
      adapter.updateMessage("C1", "100.1", "third"),
    ]);

    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ channelId: "C1", messageTs: "100.1", text: "third" });
  });

  it("tracks rate-limited updates and keeps runtime alive", async () => {
    const adapter = createRateLimitedImAdapter({
      sendMessage: async () => "m1",
      updateMessage: async () => {
        throw new Error("429 rate limited");
      },
      deleteMessage: async () => {},
      fetchThreadHistory: async () => null,
      buildAgentContext: async () => ({}),
    }, 0);

    await adapter.updateMessage("C2", "100.2", "payload");
    await sleep(5);

    expect(adapter.wasRateLimited?.("C2", "100.2")).toBe(true);
    expect(adapter.getRateLimitError?.("C2", "100.2")).toContain("429");
  });
});
