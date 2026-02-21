import { describe, expect, it, mock } from "bun:test";
import { registerSlackMessageRouter } from "./message-router";

function createDeps(overrides: Partial<Parameters<typeof registerSlackMessageRouter>[0]> = {}) {
  const handleIncomingMessage = mock(async () => {});

  return {
    app: {
      message: (handler: unknown) => handler,
    },
    isAuthorizedChannel: () => true,
    resolveWorkspaceAuth: () => undefined,
    syncWorkspaceForChannel: async () => false,
    getChannelWorkspaceName: () => "workspace",
    setChannelWorkspaceName: () => {},
    setChannelWorkspaceAuth: () => {},
    isThreadActive: () => false,
    markThreadActive: () => {},
    isGeneralSettingsCommand: () => false,
    postGeneralSettingsLauncher: async () => {},
    describeSettingsIssues: () => [],
    getChannelAgentProvider: () => "opencode" as const,
    handleStopCommand: async () => false,
    handleIncomingMessage,
    ...overrides,
  };
}

describe("registerSlackMessageRouter", () => {
  it("only treats exact 'stop' as stop command", async () => {
    let registeredHandler: ((args: any) => Promise<void>) | undefined;
    const handleStopCommand = mock(async () => true);
    const handleIncomingMessage = mock(async () => {});
    const deps = createDeps({
      app: {
        message: (handler: (args: any) => Promise<void>) => {
          registeredHandler = handler;
        },
      },
      handleStopCommand,
      handleIncomingMessage,
    });

    registerSlackMessageRouter(deps);
    expect(registeredHandler).toBeDefined();

    const say = mock(async () => {});
    const basePayload = {
      client: {
        auth: {
          test: async () => ({ user_id: "U_BOT", team_id: "T1" }),
        },
      },
      context: { teamId: "T1" },
      body: { team_id: "T1" },
      say,
    };

    await registeredHandler!({
      ...basePayload,
      message: {
        channel: "C1",
        user: "U1",
        text: "<@U_BOT> please stop this request",
        ts: "1710000000.000000",
      },
    });

    expect(handleStopCommand).toHaveBeenCalledTimes(0);
    expect(handleIncomingMessage).toHaveBeenCalledTimes(1);

    await registeredHandler!({
      ...basePayload,
      message: {
        channel: "C1",
        user: "U2",
        text: "<@U_BOT> stop",
        ts: "1710000000.000009",
      },
    });

    expect(handleStopCommand).toHaveBeenCalledTimes(1);
    expect(handleIncomingMessage).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith({ text: "Request stopped.", thread_ts: "1710000000.000009" });
  });

  it("caches bot identity and avoids auth.test on every message", async () => {
    let registeredHandler: ((args: any) => Promise<void>) | undefined;
    const authTest = mock(async () => ({ user_id: "U_BOT", team_id: "T1", enterprise_id: "E1" }));
    const handleIncomingMessage = mock(async () => {});
    const deps = createDeps({
      app: {
        message: (handler: (args: any) => Promise<void>) => {
          registeredHandler = handler;
        },
      },
      handleIncomingMessage,
    });

    registerSlackMessageRouter(deps);
    expect(registeredHandler).toBeDefined();

    const say = mock(async () => {});

    await registeredHandler!({
      message: {
        channel: "C1",
        user: "U1",
        text: "<@U_BOT> hello",
        ts: "1710000000.000001",
      },
      client: {
        auth: {
          test: authTest,
        },
      },
      context: { teamId: "T1", enterpriseId: "E1" },
      body: { team_id: "T1", enterprise_id: "E1" },
      say,
    });

    await registeredHandler!({
      message: {
        channel: "C1",
        user: "U2",
        text: "<@U_BOT> again",
        ts: "1710000000.000002",
      },
      client: {
        auth: {
          test: authTest,
        },
      },
      context: { teamId: "T1", enterpriseId: "E1" },
      body: { team_id: "T1", enterprise_id: "E1" },
      say,
    });

    expect(authTest).toHaveBeenCalledTimes(1);
    expect(handleIncomingMessage).toHaveBeenCalledTimes(2);
  });

  it("handles message processing errors with a thread reply", async () => {
    let registeredHandler: ((args: any) => Promise<void>) | undefined;
    const deps = createDeps({
      app: {
        message: (handler: (args: any) => Promise<void>) => {
          registeredHandler = handler;
        },
      },
      handleIncomingMessage: async () => {
        throw new Error("boom");
      },
    });

    registerSlackMessageRouter(deps);
    expect(registeredHandler).toBeDefined();

    const say = mock(async () => {});

    await registeredHandler!({
      message: {
        channel: "C1",
        user: "U1",
        text: "<@U_BOT> fail",
        ts: "1710000000.000003",
      },
      client: {
        auth: {
          test: async () => ({ user_id: "U_BOT", team_id: "T1" }),
        },
      },
      context: { teamId: "T1" },
      body: { team_id: "T1" },
      say,
    });

    expect(say).toHaveBeenCalledWith({
      text: "I hit an internal error while handling that message. Please try again.",
      thread_ts: "1710000000.000003",
    });
  });
});
