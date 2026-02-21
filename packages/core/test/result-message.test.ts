import { describe, expect, it } from "bun:test";
import { splitResultMessage } from "../runtime/result-message";

describe("splitResultMessage", () => {
  it("keeps short messages as one chunk", () => {
    const chunks = splitResultMessage("hello", 3000);
    expect(chunks).toEqual(["hello"]);
  });

  it("splits long messages with indexed prefixes", () => {
    const text = "a".repeat(6200);
    const chunks = splitResultMessage(text, 3000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.startsWith("(1/")).toBe(true);
    expect(chunks[chunks.length - 1]?.startsWith(`(${chunks.length}/${chunks.length}) `)).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3000);
    }
  });

  it("prefers newline boundaries when available", () => {
    const text = `${"a".repeat(2990)}\n${"b".repeat(2990)}`;
    const chunks = splitResultMessage(text, 3000);

    expect(chunks.length).toBe(2);
    expect(chunks[0]?.includes("\n")).toBe(false);
  });
});
