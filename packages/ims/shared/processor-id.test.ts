import { describe, expect, it } from "bun:test";
import { createProcessorId } from "./processor-id";

describe("processor scope", () => {
  it("creates stable processor ids", () => {
    const id1 = createProcessorId("slack", "xoxb-a");
    const id2 = createProcessorId("slack", "xoxb-a");
    const id3 = createProcessorId("slack", "xoxb-b");
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
  });

  it("uses default marker for empty credentials", () => {
    expect(createProcessorId("lark", "")).toBe("lark:default");
  });
});
