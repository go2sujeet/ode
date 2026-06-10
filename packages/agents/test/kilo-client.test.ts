import { describe, expect, it } from "bun:test";
import { extractKiloFinalResponse } from "../kilo/client";

describe("kilo response parsing", () => {
  it("extracts the last text part from current Kilo JSONL output", () => {
    const output = [
      JSON.stringify({
        type: "text",
        part: {
          text: "I will inspect the project first.",
        },
      }),
      JSON.stringify({
        type: "tool_use",
        part: {
          tool: "read",
          state: {
            status: "completed",
          },
        },
      }),
      JSON.stringify({
        type: "text",
        part: {
          text: "Updated `agent-eval/kilo.md`; validation skipped because dependencies are not installed.",
        },
      }),
    ].join("\n");

    expect(extractKiloFinalResponse(output)).toBe(
      "I will inspect the project first.\n\nUpdated `agent-eval/kilo.md`; validation skipped because dependencies are not installed."
    );
  });
});
