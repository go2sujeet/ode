import { describe, expect, it } from "bun:test";
import { buildPromptParts, buildPromptText, buildSystemPrompt, buildSystemWrappedPrompt } from "../shared";
import { buildOpenCodeCommand } from "../opencode/client";
import { buildClaudeCommand, buildClaudeCommandArgs } from "../claude/client";
import { buildCodexCommand, buildCodexCommandArgs } from "../codex/client";
import { buildKimiCommand, buildKimiCommandArgs } from "../kimi/client";
import { buildKiroCommand, buildKiroCommandArgs } from "../kiro/client";
import { buildKiloCommand, buildKiloCommandArgs } from "../kilo/client";
import { buildQwenCommand, buildQwenCommandArgs } from "../qwen/client";
import { buildGooseCommand, buildGooseCommandArgs } from "../goose/client";
import { buildGeminiCommand, buildGeminiCommandArgs } from "../gemini/client";

describe("agent cli command formatting", () => {
  it("builds the final Claude CLI command", () => {
    const message = "hello world";
    const parts = buildPromptParts("C123", message);
    const prompt = buildPromptText(parts);
    const systemPrompt = buildSystemPrompt({
      channelId: "C123",
      threadId: "T456",
      userId: "U789",
    });

    const baseArgs = buildClaudeCommandArgs({
      sessionId: "session-1",
      isNewSession: true,
      systemPrompt,
      workingPath: "/tmp/project",
      prompt,
    });

    const { command } = buildClaudeCommand(baseArgs, "dontAsk");
    console.log('=== claude command ===')
    console.log(command)

    expect(command).toContain("claude");
    expect(command).toContain("--permission-mode dontAsk --");
    expect(command).not.toContain("--append-system-prompt");
    expect(command).toContain("--session-id session-1");
    expect(command).toContain("--add-dir /tmp/project");
    expect(command).toContain("'hello world'");
  });

  it("does not inject an Ode system prompt by default", () => {
    const systemPrompt = buildSystemPrompt({
      channelId: "C123",
      threadId: "T456",
      userId: "U789",
    });

    expect(systemPrompt).toBe("");
  });

  it("uses only the explicit channel system message as system prompt", () => {
    const systemPrompt = buildSystemPrompt({
      channelId: "C123",
      threadId: "T456",
      userId: "U789",
      channelSystemMessage: "Always ask for confirmation before destructive file operations.",
    });

    expect(systemPrompt).toBe("Always ask for confirmation before destructive file operations.");
  });

  it("does not inject git or pull request guidance", () => {
    const systemPrompt = buildSystemPrompt({
      channelId: "C123",
      threadId: "1770543888.045599",
      userId: "U789",
    });

    expect(systemPrompt).not.toContain("Before creating any pull request");
    expect(systemPrompt).not.toContain("Preferred branch format before PR");
  });

  it("does not inject Discord context or platform formatting guidance", () => {
    const systemPrompt = buildSystemPrompt({
      platform: "discord",
      channelId: "C123",
      threadId: "T456",
      userId: "U789",
    });

    expect(systemPrompt).toBe("");
    expect(systemPrompt).not.toContain("DISCORD CONTEXT:");
    expect(systemPrompt).not.toContain("ODE CLI:");
    expect(systemPrompt).not.toContain("FORMATTING:");
    expect(systemPrompt).not.toContain("Discord supports markdown");
  });

  it("does not inject Lark context or platform formatting guidance", () => {
    const systemPrompt = buildSystemPrompt({
      platform: "lark",
      channelId: "oc_123",
      threadId: "om_456",
      userId: "ou_789",
    });

    expect(systemPrompt).toBe("");
    expect(systemPrompt).not.toContain("LARK CONTEXT:");
    expect(systemPrompt).not.toContain("ODE CLI:");
    expect(systemPrompt).not.toContain("FORMATTING:");
    expect(systemPrompt).not.toContain("Lark output should be plain text");
  });

  it("does not inject chat response style or task-list glyph guidance", () => {
    const systemPrompt = buildSystemPrompt({
      platform: "slack",
      channelId: "C9XXX",
      threadId: "1700000000.000001",
      userId: "U42",
    });

    expect(systemPrompt).not.toContain("COMMUNICATION STYLE:");
    expect(systemPrompt).not.toContain("PROGRESS CHECKLIST:");
    expect(systemPrompt).not.toContain("TASK LISTS:");
    expect(systemPrompt).not.toContain("Slack uses *bold*");
    expect(systemPrompt).not.toContain("Use four states");
  });

  it("does not inject Ode CLI command guidance", () => {
    const systemPrompt = buildSystemPrompt({
      platform: "slack",
      channelId: "C9XXX",
      threadId: "1700000000.000001",
      userId: "U42",
    });

    expect(systemPrompt).not.toContain("ode task create");
    expect(systemPrompt).not.toContain("ode cron create");
    expect(systemPrompt).not.toContain("ode send file");
    expect(systemPrompt).not.toContain("ode messages get");
    expect(systemPrompt).not.toContain("ode reaction add");
    expect(systemPrompt).not.toContain("VISUAL TESTING:");
  });

  it("does not wrap prompts when no system prompt is present", () => {
    expect(buildSystemWrappedPrompt("", "hello")).toBe("hello");
  });

  it("wraps only explicit system prompts", () => {
    expect(buildSystemWrappedPrompt("custom rules", "hello")).toBe("<system-prompt>\ncustom rules\n</system-prompt>\n\nhello");
  });

  it("builds the OpenCode curl command", () => {
    const command = buildOpenCodeCommand("http://127.0.0.1:8080", "session-2", {
      directory: "/tmp/project",
      parts: [{ type: "text", text: "ping" }],
    });
    console.log('=== opencode command ===')
    console.log(command)

    expect(command).toContain("curl -s -X POST");
    expect(command).toContain("/session/session-2/prompt");
    expect(command).toContain("--data-raw");
    expect(command).toContain("\"ping\"");
  });

  it("builds the Codex exec command", () => {
    const args = buildCodexCommandArgs({
      sessionId: "session-3",
      model: "gpt-5-codex",
      prompt: "hello from codex",
      isNewSession: false,
    });
    const command = buildCodexCommand(args);

    expect(command).toContain("codex exec --json --skip-git-repo-check");
    expect(command).toContain("--json");
    expect(command).toContain("--yolo");
    expect(command).toContain("--model gpt-5-codex");
    expect(command).toContain("session-3");
    expect(command).toContain("'hello from codex'");
  });

  it("builds the Codex plan command", () => {
    const args = buildCodexCommandArgs({
      sessionId: "session-3",
      model: "gpt-5-codex",
      prompt: "plan this change",
      planMode: true,
      isNewSession: false,
    });
    const command = buildCodexCommand(args);

    expect(command).toContain("codex exec --json --skip-git-repo-check");
    expect(command).toContain("--json");
    expect(command).toContain("--sandbox read-only");
    expect(command).not.toContain("--yolo");
    expect(command).toContain("session-3");
    expect(command).toContain("'plan this change'");
  });

  it("omits the Codex model flag when no model is configured", () => {
    const args = buildCodexCommandArgs({
      sessionId: "session-3",
      prompt: "hello from codex",
      isNewSession: false,
    });
    const command = buildCodexCommand(args);

    expect(command).not.toContain("--model");
    expect(command).toContain("session-3");
    expect(command).toContain("'hello from codex'");
  });

  it("starts a new Codex exec session without resume", () => {
    const args = buildCodexCommandArgs({
      sessionId: "session-3",
      prompt: "hello from codex",
      isNewSession: true,
    });
    const command = buildCodexCommand(args);

    expect(command).toContain("codex exec --json --skip-git-repo-check");
    expect(command).not.toContain("resume session-3");
    expect(command).toContain("'hello from codex'");
  });

  it("builds the Kimi prompt command", () => {
    const args = buildKimiCommandArgs({
      sessionId: "session-4",
      workingPath: "/tmp/project",
      prompt: "hello from kimi",
      isNewSession: false,
    });
    const command = buildKimiCommand(args);

    expect(command).not.toContain("--print");
    expect(command).toContain("--output-format stream-json");
    expect(command).toContain("--session session-4");
    expect(command).not.toContain("--work-dir");
    expect(command).toContain("-p 'hello from kimi'");
  });

  it("starts a new Kimi prompt without a resume session", () => {
    const args = buildKimiCommandArgs({
      sessionId: "session-4",
      workingPath: "/tmp/project",
      prompt: "hello from kimi",
      isNewSession: true,
    });
    const command = buildKimiCommand(args);

    expect(command).toContain("--output-format stream-json");
    expect(command).not.toContain("--session session-4");
    expect(command).toContain("-p 'hello from kimi'");
  });

  it("builds the Kiro non-interactive command", () => {
    const args = buildKiroCommandArgs({
      isNewSession: false,
      prompt: "hello from kiro",
      agent: "plan",
    });
    const command = buildKiroCommand("kiro-cli", args);

    expect(command).toContain("kiro-cli chat");
    expect(command).toContain("--no-interactive");
    expect(command).toContain("--trust-all-tools");
    expect(command).toContain("--resume");
    expect(command).toContain("--agent plan");
    expect(command).toContain("'hello from kiro'");
  });

  it("builds the Kilo run command", () => {
    const args = buildKiloCommandArgs({
      sessionId: "session-7",
      prompt: "hello from kilo",
      agent: "plan",
      model: { providerID: "openai", modelID: "gpt-4" },
    });
    const command = buildKiloCommand(args);

    expect(command).toContain("kilo run --auto --format json");
    expect(command).toContain("--session session-7");
    expect(command).toContain("--agent plan");
    expect(command).toContain("--model openai/gpt-4");
    expect(command).toContain("'hello from kilo'");
  });

  it("builds the Qwen plan-mode command", () => {
    const args = buildQwenCommandArgs({
      sessionId: "session-5",
      isNewSession: false,
      prompt: "plan migration",
      approvalMode: "plan",
    });
    const command = buildQwenCommand(args);

    expect(command).toContain("--approval-mode plan");
    expect(command).not.toContain("--yolo");
    expect(command).toContain("--resume session-5");
    expect(command).toContain("-p 'plan migration'");
  });

  it("builds the Qwen default automation command", () => {
    const args = buildQwenCommandArgs({
      sessionId: "session-6",
      isNewSession: true,
      prompt: "implement feature",
    });
    const command = buildQwenCommand(args);

    expect(command).toContain("--yolo");
    expect(command).not.toContain("--approval-mode plan");
  });

  it("builds the Goose run command", () => {
    const args = buildGooseCommandArgs({
      sessionId: "session-8",
      isNewSession: true,
      prompt: "hello from goose",
    });
    const command = buildGooseCommand(args);

    expect(command).toContain("goose run --output-format stream-json");
    expect(command).toContain("--name session-8");
    expect(command).toContain("-t 'hello from goose'");
    expect(command).not.toContain("--resume");
  });

  it("builds the Goose resume command", () => {
    const args = buildGooseCommandArgs({
      sessionId: "session-9",
      isNewSession: false,
      prompt: "resume this",
    });
    const command = buildGooseCommand(args);

    expect(command).toContain("--resume");
    expect(command).toContain("--name session-9");
  });

  it("builds the Gemini plan-mode command", () => {
    const args = buildGeminiCommandArgs({
      sessionId: "session-10",
      isNewSession: false,
      prompt: "plan migration",
      approvalMode: "plan",
      model: "gemini-3.1-flash-lite",
    });
    const command = buildGeminiCommand(args);

    expect(command).toContain("gemini");
    expect(command).toContain("--output-format stream-json");
    expect(command).toContain("--approval-mode plan");
    expect(command).toContain("--model gemini-3.1-flash-lite");
    expect(command).toContain("--resume session-10");
    expect(command).toContain("-p 'plan migration'");
  });

  it("builds the Gemini default automation command", () => {
    const args = buildGeminiCommandArgs({
      sessionId: "session-11",
      isNewSession: true,
      prompt: "implement feature",
    });
    const command = buildGeminiCommand(args);

    expect(command).toContain("--approval-mode yolo");
    expect(command).not.toContain("--resume");
  });
});
