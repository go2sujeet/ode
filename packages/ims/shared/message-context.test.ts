import { describe, expect, it } from "bun:test";
import { toCoreMessageContext } from "./message-context";

describe("toCoreMessageContext", () => {
  it("maps unified context to core context", () => {
    const result = toCoreMessageContext(
      {
        channelId: "C1",
        threadId: "T1",
        replyThreadId: "T2",
        messageId: "M1",
        userId: "U1",
      },
      { workspaceName: "workspace" }
    );

    expect(result).toEqual({
      channelId: "C1",
      threadId: "T1",
      replyThreadId: "T2",
      messageId: "M1",
      userId: "U1",
      workspaceName: "workspace",
    });
  });
});
