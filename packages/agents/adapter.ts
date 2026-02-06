import type { AgentAdapter, NormalizedQuestion } from "@/core/types";
import type { QuestionInfo } from "@opencode-ai/sdk/v2";
import {
  selectedAgent,
  getOrCreateSession,
  sendMessage,
  abortSession,
  ensureSession,
  subscribeToSession,
  supportsEventStream,
} from "./index";
import { getSessionClient } from "./opencode";

export function createAgentAdapter(): AgentAdapter {
  return {
    supportsEventStream,
    getOrCreateSession,
    sendMessage,
    abortSession,
    ensureSession,
    subscribeToSession,
    async replyToQuestion({ requestId, sessionId, directory, answers }) {
      if (selectedAgent !== "opencode") {
        throw new Error(`Question replies are not supported for agent: ${selectedAgent}`);
      }
      const client = await getSessionClient(sessionId);
      const response = await client.question.reply({
        requestID: requestId,
        directory,
        answers,
      });
      if (response.error) {
        throw new Error(`OpenCode question reply error: ${response.error}`);
      }
    },
    normalizeQuestions(questions: unknown): NormalizedQuestion[] {
      if (selectedAgent !== "opencode") return [];
      if (!Array.isArray(questions) || questions.length === 0) return [];
      return (questions as QuestionInfo[])
        .map((question) => {
          const prompt =
            typeof question.question === "string" ? question.question.trim() : "";
          const options = Array.isArray(question.options)
            ? question.options
                .map((option) =>
                  typeof option?.label === "string" ? option.label : "",
                )
                .filter((label) => label.length > 0)
            : undefined;
          return {
            question: prompt,
            options: options && options.length > 0 ? options : undefined,
            multiple: question.multiple,
            custom: question.custom,
          };
        })
        .filter((question) => question.question.length > 0);
    },
  };
}
