import { describe, expect, it } from "bun:test";
import { shouldProcessIncomingMessage } from "./message-context";

describe("shouldProcessIncomingMessage", () => {
  it("requires mention for top-level messages", () => {
    expect(shouldProcessIncomingMessage({ isTopLevel: true, mentionedBot: true, activeThread: false })).toBe(true);
    expect(shouldProcessIncomingMessage({ isTopLevel: true, mentionedBot: false, activeThread: true })).toBe(false);
  });

  it("accepts thread replies when mentioned or thread is active", () => {
    expect(shouldProcessIncomingMessage({ isTopLevel: false, mentionedBot: true, activeThread: false })).toBe(true);
    expect(shouldProcessIncomingMessage({ isTopLevel: false, mentionedBot: false, activeThread: true })).toBe(true);
    expect(shouldProcessIncomingMessage({ isTopLevel: false, mentionedBot: false, activeThread: false })).toBe(false);
  });
});
