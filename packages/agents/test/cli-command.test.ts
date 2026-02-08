import { describe, expect, it } from "bun:test";
import { buildPromptParts, buildPromptText, buildSystemPrompt } from "../shared";
import { buildOpenCodeCommand } from "../opencode/client";
import { buildClaudeCommand, buildClaudeCommandArgs } from "../claude/client";
import { buildCodexCommand, buildCodexCommandArgs } from "../codex/client";
import { buildKimiCommand, buildKimiCommandArgs } from "../kimi/client";
import { buildKiroCommand, buildKiroCommandArgs } from "../kiro/client";
import { buildQwenCommand, buildQwenCommandArgs } from "../qwen/client";

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
    expect(command).toContain("--session-id session-1");
    expect(command).toContain("--add-dir /tmp/project");
    expect(command).toContain("'hello world'");
  });

  it("appends channel system message into system prompt", () => {
    const systemPrompt = buildSystemPrompt({
      channelId: "C123",
      threadId: "T456",
      userId: "U789",
      channelSystemMessage: "Always ask for confirmation before destructive file operations.",
    });

    expect(systemPrompt).toContain("Always ask for confirmation before destructive file operations.");
    expect(systemPrompt).not.toContain("CHANNEL SYSTEM MESSAGE:");
  });

  it("includes branch rename guidance before creating pull requests", () => {
    const systemPrompt = buildSystemPrompt({
      channelId: "C123",
      threadId: "1770543888.045599",
      userId: "U789",
    });

    expect(systemPrompt).toContain("Before creating any pull request, make sure the current branch name is meaningful.");
    expect(systemPrompt).toContain("Preferred branch format before PR: `feat/<short-slug>-<threadShortId>`");
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
    });
    const command = buildCodexCommand(args);

    expect(command).toContain("codex exec --json --skip-git-repo-check");
    expect(command).toContain("--json");
    expect(command).toContain("--full-auto");
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
    });
    const command = buildCodexCommand(args);

    expect(command).toContain("codex exec --json --skip-git-repo-check");
    expect(command).toContain("--json");
    expect(command).toContain("--sandbox read-only");
    expect(command).not.toContain("--full-auto");
    expect(command).toContain("session-3");
    expect(command).toContain("'plan this change'");
  });

  it("builds the Kimi print command", () => {
    const args = buildKimiCommandArgs({
      sessionId: "session-4",
      workingPath: "/tmp/project",
      prompt: "hello from kimi",
    });
    const command = buildKimiCommand(args);

    expect(command).toContain("kimi --print");
    expect(command).toContain("--output-format stream-json");
    expect(command).toContain("--session session-4");
    expect(command).toContain("--work-dir /tmp/project");
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
});
