import { describe, expect, it } from "bun:test";
import {
  deleteSession,
  getPendingQuestion,
  saveSession,
  setPendingQuestion,
  type PendingQuestion,
} from "@/config/local/sessions";
import { handlePendingQuestionReply } from "../runtime/pending-question";

describe("handlePendingQuestionReply", () => {
  it("submits answers and clears pending question", async () => {
    const channelId = "CQ-PENDING-1";
    const threadId = "TQ-PENDING-1";
    const userId = "U-OWNER-1";
    const pending: PendingQuestion = {
      requestId: "req-1",
      sessionId: "ses-1",
      askedAt: Date.now(),
      questions: [{ question: "Q1" }, { question: "Q2" }],
    };

    saveSession({
      sessionId: "ses-1",
      channelId,
      threadId,
      workingDirectory: "/tmp",
      threadOwnerUserId: userId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      pendingQuestion: pending,
    });
    setPendingQuestion(channelId, threadId, pending);

    const replies: Array<Array<Array<string>>> = [];
    const handled = await handlePendingQuestionReply({
      deps: {
        agent: {
          replyToQuestion: async ({ answers }: { answers: Array<Array<string>> }) => {
            replies.push(answers);
          },
        } as any,
        im: {
          sendMessage: async () => undefined,
        } as any,
      },
      pendingQuestion: pending,
      context: {
        channelId,
        threadId,
        userId,
        messageId: `m-${Date.now()}`,
      },
      text: "first\nsecond",
    });

    expect(handled).toBe(true);
    expect(replies).toEqual([[["first"], ["second"]]]);
    expect(getPendingQuestion(channelId, threadId)).toBeNull();

    deleteSession(channelId, threadId);
  });

  it("ignores non-owner replies", async () => {
    const channelId = "CQ-PENDING-2";
    const threadId = "TQ-PENDING-2";
    const ownerUserId = "U-OWNER-2";
    const pending: PendingQuestion = {
      requestId: "req-2",
      sessionId: "ses-2",
      askedAt: Date.now(),
      questions: [{ question: "Q1" }],
    };

    saveSession({
      sessionId: "ses-2",
      channelId,
      threadId,
      workingDirectory: "/tmp",
      threadOwnerUserId: ownerUserId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      pendingQuestion: pending,
    });

    const handled = await handlePendingQuestionReply({
      deps: {
        agent: {
          replyToQuestion: async () => {},
        } as any,
        im: {
          sendMessage: async () => undefined,
        } as any,
      },
      pendingQuestion: pending,
      context: {
        channelId,
        threadId,
        userId: "U-NON-OWNER",
        messageId: `m-${Date.now()}-2`,
      },
      text: "answer",
    });

    expect(handled).toBe(false);
    expect(getPendingQuestion(channelId, threadId)).not.toBeNull();

    deleteSession(channelId, threadId);
  });
});
