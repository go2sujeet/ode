import { describe, expect, it } from "bun:test";
import { isMessageProcessed, markMessageProcessed } from "@/config/local/sessions";

describe("message deduplication key", () => {
  it("treats same messageTs in different threads as distinct", () => {
    const messageTs = `m-${Date.now()}-shared`;
    const channelA = "C-DEDUP-A";
    const channelB = "C-DEDUP-B";
    const threadA = "T-DEDUP-A";
    const threadB = "T-DEDUP-B";

    expect(isMessageProcessed(channelA, threadA, messageTs)).toBe(false);
    expect(isMessageProcessed(channelB, threadB, messageTs)).toBe(false);

    markMessageProcessed(channelA, threadA, messageTs);

    expect(isMessageProcessed(channelA, threadA, messageTs)).toBe(true);
    expect(isMessageProcessed(channelB, threadB, messageTs)).toBe(false);
  });

  it("still deduplicates same channel/thread/messageTs", () => {
    const channelId = "C-DEDUP-C";
    const threadId = "T-DEDUP-C";
    const messageTs = `m-${Date.now()}-same`;

    expect(isMessageProcessed(channelId, threadId, messageTs)).toBe(false);
    markMessageProcessed(channelId, threadId, messageTs);
    expect(isMessageProcessed(channelId, threadId, messageTs)).toBe(true);
  });
});
