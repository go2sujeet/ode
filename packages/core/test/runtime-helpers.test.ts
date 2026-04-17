import { describe, expect, it } from "bun:test";
import {
  buildFinalResponseText,
  buildQuestionAnswers,
  categorizeRuntimeError,
  formatQuestionPrompt,
  formatSingleQuestionPrompt,
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

  it("formats a single-question prompt with i/N prefix in multi-question flows", () => {
    const prompt = formatSingleQuestionPrompt(
      { question: "Need tests?", options: ["yes", "no"] },
      1,
      2
    );

    expect(prompt).toContain("(2/2)");
    expect(prompt).toContain("Need tests?");
    expect(prompt).toContain("Options: yes / no");
  });

  it("omits i/N prefix for single-question flows", () => {
    const prompt = formatSingleQuestionPrompt(
      { question: "Proceed?", options: ["yes", "no"] },
      0,
      1
    );

    expect(prompt).not.toContain("(1/1)");
    expect(prompt.startsWith("Proceed?")).toBe(true);
  });

  it("wraps accumulated answers into the nested shape expected by agents", () => {
    const answers = buildQuestionAnswers(["first", "second", "third"]);

    expect(answers).toEqual([["first"], ["second"], ["third"]]);
  });

  it("categorizes network errors with server override", () => {
    const result = categorizeRuntimeError(new Error("ECONNREFUSED connect failed"));
    expect(result.message).toContain("http://127.0.0.1:4096");
    expect(result.suggestion).toContain("OpenCode server");
  });

  it("categorizes timed out phrasing as timeout", () => {
    const result = categorizeRuntimeError(new Error("Codex CLI timed out"));
    expect(result.message).toBe("Request timed out");
  });
});
