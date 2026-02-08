import { describe, expect, it } from "bun:test";
import { buildPromptParts, buildPromptText, buildSystemPrompt } from "../shared";
import { buildOpenCodeCommand } from "../opencode/client";
import { buildClaudeCommand, buildClaudeCommandArgs } from "../claude/client";
import { buildCodexCommand, buildCodexCommandArgs } from "../codex/client";
import { buildKimiCommand, buildKimiCommandArgs } from "../kimi/client";

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

    expect(command).toContain("codex exec resume");
    expect(command).toContain("--json");
    expect(command).toContain("--full-auto");
    expect(command).toContain("--model gpt-5-codex");
    expect(command).toContain("session-3");
    expect(command).toContain("'hello from codex'");
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
});
