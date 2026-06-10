import { beforeEach, describe, expect, it, mock } from "bun:test";

const apiCalls: Array<{ method: string; args: Record<string, unknown> }> = [];

mock.module("./client", () => ({
  getApp: () => ({
    client: {
      apiCall: async (method: string, args: Record<string, unknown>) => {
        apiCalls.push({ method, args });
        return method === "chat.startStream" ? { ts: "111.222" } : {};
      },
    },
  }),
  getSlackBotToken: () => "xoxb-test",
}));

describe("Slack streaming API helpers", () => {
  beforeEach(() => {
    apiCalls.length = 0;
  });

  it("uses raw apiCall methods for stream lifecycle operations", async () => {
    const { appendSlackStream, startSlackStream, stopSlackStream } = await import("./api");

    const ts = await startSlackStream({
      channelId: "C1",
      threadId: "1700000000.000001",
      recipientUserId: "U1",
      recipientTeamId: "T1",
      seedPlanTitle: "Working",
      token: "xoxb-test",
    });
    await appendSlackStream({
      channelId: "C1",
      messageTs: ts!,
      chunks: [{ type: "plan_update", title: "Still working" }],
      token: "xoxb-test",
    });
    await stopSlackStream({
      channelId: "C1",
      messageTs: ts!,
      token: "xoxb-test",
    });

    expect(apiCalls.map((call) => call.method)).toEqual([
      "chat.startStream",
      "chat.appendStream",
      "chat.stopStream",
    ]);
    expect(apiCalls[0]?.args).toMatchObject({
      channel: "C1",
      thread_ts: "1700000000.000001",
      recipient_user_id: "U1",
      recipient_team_id: "T1",
      token: "xoxb-test",
    });
    expect(apiCalls[1]?.args).toMatchObject({
      channel: "C1",
      ts: "111.222",
      token: "xoxb-test",
    });
    expect(apiCalls[2]?.args).toMatchObject({
      channel: "C1",
      ts: "111.222",
      token: "xoxb-test",
    });
  });
});
