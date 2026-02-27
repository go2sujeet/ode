import { describe, expect, it } from "bun:test";
import { SlackAuthRegistry, type WorkspaceAuth } from "@/ims/slack/state/auth-registry";

function buildAuth(overrides?: Partial<WorkspaceAuth>): WorkspaceAuth {
  return {
    appToken: "xapp-1",
    botToken: "xoxb-1",
    workspaceId: "W1",
    workspaceName: "Workspace One",
    teamId: "T1",
    enterpriseId: null,
    botUserId: "U1",
    botId: "B1",
    userId: "U1",
    ...overrides,
  };
}

describe("SlackAuthRegistry", () => {
  it("registers and resolves auth by workspace/bot/app key", () => {
    const registry = new SlackAuthRegistry();
    const auth = buildAuth();
    registry.registerWorkspaceAuth(auth);

    expect(registry.resolveWorkspaceAuth("W1")?.botToken).toBe("xoxb-1");
    expect(registry.resolveWorkspaceAuth("xoxb-1")?.workspaceId).toBe("W1");
    expect(registry.getWorkspaceAuthByAppToken("xapp-1")?.workspaceId).toBe("W1");
  });

  it("tracks thread/message tokens and channel workspace mapping", () => {
    const registry = new SlackAuthRegistry();
    registry.registerWorkspaceAuth(buildAuth());
    registry.setChannelWorkspaceName("C1", "Workspace One");
    registry.setChannelWorkspaceAuthByBotToken("C1", "xoxb-1");
    registry.setThreadBotToken("C1", "T1", "xoxb-1");
    registry.setMessageBotToken("C1", "100.2", "xoxb-1");

    expect(registry.getChannelWorkspaceName("C1")).toBe("Workspace One");
    expect(registry.getChannelWorkspaceBotToken("C1")).toBe("xoxb-1");
    expect(registry.getThreadBotToken("C1", "T1")).toBe("xoxb-1");
    expect(registry.getMessageBotToken("C1", "100.2")).toBe("xoxb-1");
  });
});
