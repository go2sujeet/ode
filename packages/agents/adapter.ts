import type { AgentAdapter, NormalizedQuestion } from "@/core/types";
import { getChannelAgentProvider } from "@/config";
import type { QuestionInfo } from "@opencode-ai/sdk/v2";
import { getAgentProvider, type AgentProviderId } from "./registry";
import { getSessionClient } from "./opencode";

const sessionProviders = new Map<string, AgentProviderId>();

function getProviderForChannel(channelId: string): AgentProviderId {
  return getChannelAgentProvider(channelId);
}

function getProviderForSession(sessionId: string): AgentProviderId {
  return sessionProviders.get(sessionId) ?? "opencode";
}

function rememberSessionProvider(sessionId: string, providerId: AgentProviderId): void {
  sessionProviders.set(sessionId, providerId);
}

export function createAgentAdapter(): AgentAdapter {
  return {
    supportsEventStream: true,
    async getOrCreateSession(channelId, threadId, cwd, env) {
      const providerId = getProviderForChannel(channelId);
      const provider = getAgentProvider(providerId);
      const result = await provider.getOrCreateSession(channelId, threadId, cwd, env);
      rememberSessionProvider(result.sessionId, providerId);
      return result;
    },
    async sendMessage(channelId, sessionId, message, cwd, options, context) {
      const providerId = getProviderForSession(sessionId);
      const provider = getAgentProvider(providerId);
      const responses = await provider.sendMessage(
        channelId,
        sessionId,
        message,
        cwd,
        options,
        context
      );
      rememberSessionProvider(sessionId, providerId);
      return responses;
    },
    async abortSession(sessionId, directory) {
      const provider = getAgentProvider(getProviderForSession(sessionId));
      await provider.abortSession(sessionId, directory);
    },
    async ensureSession(sessionId) {
      const provider = getAgentProvider(getProviderForSession(sessionId));
      await provider.ensureSession(sessionId);
    },
    subscribeToSession(sessionId, handler) {
      const provider = getAgentProvider(getProviderForSession(sessionId));
      return provider.subscribeToSession(sessionId, handler);
    },
    async replyToQuestion({ requestId, sessionId, directory, answers }) {
      const providerId = getProviderForSession(sessionId);
      if (providerId !== "opencode") {
        throw new Error(`Question replies are not supported for agent: ${providerId}`);
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
      if (!Array.isArray(questions) || questions.length === 0) return [];
      return (questions as QuestionInfo[])
        .map((question) => {
          const prompt = typeof question.question === "string" ? question.question.trim() : "";
          const options = Array.isArray(question.options)
            ? question.options
                .map((option) => (typeof option?.label === "string" ? option.label : ""))
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
