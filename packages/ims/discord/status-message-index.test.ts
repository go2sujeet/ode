import { describe, expect, it } from "bun:test";
import { DiscordStatusMessageIndex } from "@/ims/discord/state/status-message-index";

describe("DiscordStatusMessageIndex", () => {
  it("stores and clears message to thread mapping", () => {
    const index = new DiscordStatusMessageIndex();
    index.setThreadId("m1", "t1");
    expect(index.getThreadId("m1")).toBe("t1");
    index.clear();
    expect(index.getThreadId("m1")).toBeUndefined();
  });
});
