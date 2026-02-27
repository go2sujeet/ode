import {
  clearPendingQuestion,
  isMessageProcessed,
  loadSession,
  markMessageProcessed,
  type PendingQuestion,
} from "@/config/local/sessions";
import { buildQuestionAnswers } from "@/core/runtime/helpers";
import type { AgentAdapter, IMAdapter } from "@/core/types";
import type { RuntimeRequestContext } from "@/core/kernel/request-context";
import { log } from "@/utils";

export async function handlePendingQuestionReply(params: {
  deps: {
    im: IMAdapter;
    agent: AgentAdapter;
  };
  pendingQuestion: PendingQuestion;
  context: RuntimeRequestContext;
  text: string;
}): Promise<boolean> {
  const { deps, pendingQuestion, context, text } = params;

  if (isMessageProcessed(context.channelId, context.threadId, context.messageId)) {
    log.debug("Skipping duplicate question reply", { messageId: context.messageId });
    return true;
  }

  const session = loadSession(context.channelId, context.threadId);
  const threadOwnerUserId = session?.threadOwnerUserId;
  if (threadOwnerUserId && threadOwnerUserId !== context.userId) {
    return false;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    await deps.im.sendMessage(context.channelId, context.replyThreadId, "Please reply with an answer.");
    return true;
  }

  markMessageProcessed(context.channelId, context.threadId, context.messageId);

  try {
    const answers = buildQuestionAnswers(pendingQuestion.questions, trimmed);
    await deps.agent.replyToQuestion({
      requestId: pendingQuestion.requestId,
      sessionId: pendingQuestion.sessionId,
      directory: session?.workingDirectory,
      answers,
    });
    clearPendingQuestion(context.channelId, context.threadId);
    return true;
  } catch (err) {
    log.error("Failed to answer OpenCode question", { error: String(err) });
    await deps.im.sendMessage(
      context.channelId,
      context.replyThreadId,
      "Failed to submit your answer. Please try again."
    );
    return true;
  }
}
