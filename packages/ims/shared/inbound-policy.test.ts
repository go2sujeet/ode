import { describe, expect, it } from "bun:test";
import { defaultInboundPolicy } from "./inbound-policy";

describe("defaultInboundPolicy", () => {
  it("drops thread messages that mention another target", () => {
    const decision = defaultInboundPolicy({
      selfMessage: false,
      threadOwnerMessage: true,
      isTopLevel: false,
      hasAnyMention: true,
      mentionedBot: false,
      activeThread: true,
      normalizedText: "<@other> handle this",
    });

    expect(decision).toEqual({ kind: "ignore", reason: "not_mentioned_and_inactive" });
  });

  it("keeps active-thread owner follow-ups without mentions", () => {
    const decision = defaultInboundPolicy({
      selfMessage: false,
      threadOwnerMessage: true,
      isTopLevel: false,
      hasAnyMention: false,
      mentionedBot: false,
      activeThread: true,
      normalizedText: "continue",
    });

    expect(decision).toEqual({ kind: "message", text: "continue" });
  });
});
