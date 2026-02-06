import { describe, expect, it } from "bun:test";
import {
  buildFinalResponseText,
  buildQuestionAnswers,
  categorizeRuntimeError,
  formatQuestionPrompt,
} from "../runtime/helpers";

describe("runtime helpers", () => {
  it("joins non-empty response texts", () => {
    const text = buildFinalResponseText([
      { text: "  first  " },
      { text: "" },
      {},
      { text: "second" },
    ]);

    expect(text).toBe("first\n\nsecond");
  });

  it("returns null for empty response texts", () => {
    const text = buildFinalResponseText([{ text: "   " }, {}]);
    expect(text).toBeNull();
  });

  it("formats multi-question prompts with numbered lines", () => {
    const prompt = formatQuestionPrompt([
      { question: "Pick runtime", options: ["opencode", "claude"] },
      { question: "Need tests?", options: ["yes", "no"] },
    ]);

    expect(prompt).toContain("1. Pick runtime");
    expect(prompt).toContain("Options: opencode / claude");
    expect(prompt).toContain("2. Need tests?");
  });

  it("maps multi-line user answers to multiple questions", () => {
    const answers = buildQuestionAnswers(
      [{ question: "Q1" }, { question: "Q2" }, { question: "Q3" }],
      "first\n\nsecond"
    );

    expect(answers).toEqual([["first"], ["second"], [""]]);
  });

  it("categorizes network errors with server override", () => {
    const result = categorizeRuntimeError(new Error("ECONNREFUSED connect failed"), "http://127.0.0.1:4096");
    expect(result.message).toContain("http://127.0.0.1:4096");
    expect(result.suggestion).toContain("OpenCode server");
  });
});
