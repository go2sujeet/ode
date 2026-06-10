import { describe, expect, it } from "bun:test";
import { createActiveRequest, deleteSession, loadSession, saveSession } from "@/config/local/sessions";
import { handleStopCommand } from "../kernel/stop-command";
import type { AgentAdapter, IMAdapter } from "@/core/types";

function createAgent(): AgentAdapter {
  return {
    supportsEventStream: false,
    getProviderForSession: () => "opencode",
    getDisplayNameForSession: () => "FakeAgent",
    getOrCreateSession: async () => ({ sessionId: "session-stop", created: false }),
    sendMessage: async () => [],
    abortSession: async () => {},
    ensureSession: async () => {},
    subscribeToSession: () => () => {},
    replyToQuestion: async () => {},
    normalizeQuestions: () => [],
  };
}

describe("handleStopCommand", () => {
  it("stops an active status stream before deleting the status message", async () => {
    const channelId = `C-stop-${process.pid}-${Date.now()}`;
    const threadId = `T-stop-${process.pid}-${Date.now()}`;
    const statusTs = "123.456";
    const activeRequest = createActiveRequest("session-stop", channelId, threadId, threadId, statusTs, "hello");
    activeRequest.statusStreamActive = true;
    activeRequest.statusStreamTs = statusTs;

    saveSession({
      sessionId: "session-stop",
      channelId,
      threadId,
      workingDirectory: "/tmp",
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      activeRequest,
    }, { immediate: true });

    const calls: string[] = [];
    const im: IMAdapter = {
      sendMessage: async () => "unused",
      updateMessage: async () => undefined,
      stopStatusStream: async (_channelId, messageTs) => {
        calls.push(`stop:${messageTs}`);
      },
      deleteMessage: async (_channelId, messageTs) => {
        calls.push(`delete:${messageTs}`);
      },
      fetchThreadHistory: async () => null,
      buildAgentContext: async () => ({}),
    };

    await handleStopCommand({
      deps: { agent: createAgent(), im },
      channelId,
      threadId,
    });

    expect(calls).toEqual([`stop:${statusTs}`, `delete:${statusTs}`]);
    const saved = loadSession(channelId, threadId)?.activeRequest;
    expect(saved?.state).toBe("failed");
    expect(saved?.statusStreamActive).toBe(false);

    deleteSession(channelId, threadId);
  });
});
