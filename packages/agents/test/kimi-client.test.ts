import { describe, expect, it } from "bun:test";
import { parseKimiResponse } from "../kimi/client";

describe("kimi response parsing", () => {
  it("prefers assistant role content when present", () => {
    const output = [
      JSON.stringify({ role: "assistant", content: [{ type: "text", text: "hello" }] }),
      JSON.stringify({ role: "assistant", content: [{ type: "text", text: "world" }] }),
    ].join("\n");

    expect(parseKimiResponse(output)).toBe("hello\n\nworld");
  });

  it("falls back to non-assistant content when assistant output is missing", () => {
    const output = [
      JSON.stringify({ role: "tool", content: [{ type: "text", text: "tool result" }] }),
    ].join("\n");

    expect(parseKimiResponse(output)).toBe("tool result");
  });

  it("returns placeholder text for empty output", () => {
    expect(parseKimiResponse("\n\n")).toBe("Kimi completed without textual output.");
  });
});
