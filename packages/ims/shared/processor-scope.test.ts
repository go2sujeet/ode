import { describe, expect, it } from "bun:test";
import {
  createProcessorId,
  getScopedProcessorId,
  parseScopedChannelId,
  scopeChannelId,
  unscopeChannelId,
} from "./processor-scope";

describe("processor scope", () => {
  it("creates stable processor ids", () => {
    const id1 = createProcessorId("slack", "xoxb-a");
    const id2 = createProcessorId("slack", "xoxb-a");
    const id3 = createProcessorId("slack", "xoxb-b");
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
  });

  it("scopes and unscopes channel ids", () => {
    const processorId = createProcessorId("discord", "token-1");
    const scoped = scopeChannelId(processorId, "C123");
    expect(getScopedProcessorId(scoped)).toBe(processorId);
    expect(unscopeChannelId(scoped)).toBe("C123");
    expect(parseScopedChannelId(scoped)).toEqual({ processorId, channelId: "C123" });
  });

  it("returns null when channel is not scoped", () => {
    expect(parseScopedChannelId("C123")).toBeNull();
    expect(getScopedProcessorId("C123")).toBeUndefined();
    expect(unscopeChannelId("C123")).toBe("C123");
  });
});
