import type { AgentAdapter, NormalizedQuestion } from "@/core/types";
import { getChannelAgentProvider } from "@/config";
import type { QuestionInfo } from "@opencode-ai/sdk/v2";
import { getAgentProvider, type AgentProviderId } from "./registry";
import { getSessionClient } from "./opencode";
import {
  buildLiveStatusMessage,
  formatElapsedTime,
  getToolIcon,
  trimToolPath,
  type StatusRequest,
} from "@/utils/status";
import type { SessionMessageState } from "@/utils/session-inspector";
import type { MessageFrequency } from "@/config/message-frequency";

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

function buildClaudeToolDetail(tool: SessionMessageState["tools"][number], workingPath: string): string {
  const input = tool.input || {};
  const filePath = input.filePath || input.file_path;
  const path = input.path;
  const pattern = input.pattern;
  const command = input.command;

  if (typeof filePath === "string" && filePath.trim()) {
    return trimToolPath(filePath, workingPath);
  }
  if (typeof pattern === "string" && pattern.trim()) {
    if (typeof path === "string" && path.trim()) {
      return `${pattern} in ${trimToolPath(path, workingPath)}`;
    }
    return pattern;
  }
  if (typeof path === "string" && path.trim()) {
    return trimToolPath(path, workingPath);
  }
  if (typeof command === "string" && command.trim()) {
    return command;
  }
  if (typeof tool.title === "string" && tool.title.trim()) {
    return trimToolPath(tool.title, workingPath);
  }
  return "";
}

function buildClaudeStatusMessage(
  request: StatusRequest,
  workingPath: string,
  state?: SessionMessageState,
  frequency: MessageFrequency = "medium"
): string {
  if (!state) {
    if (request.statusFrozen && request.currentText) return request.currentText;
    return `_Thinking_ (${formatElapsedTime(request.startedAt)})`;
  }

  if (request.statusFrozen && request.currentText) {
    return request.currentText;
  }

  const lines: string[] = [];
  const title = state.sessionTitle || "ClaudeCode";
  lines.push(`*${title}* (${formatElapsedTime(state.startedAt)})`);

  const phase = state.phaseStatus?.trim() || "Thinking";
  lines.push(`_${phase}_`);

  const toolLimitByFrequency: Record<MessageFrequency, number> = {
    minimum: 2,
    medium: 3,
    aggressive: 5,
  };
  const tools = state.tools || [];
  if (tools.length > 0) {
    const limit = toolLimitByFrequency[frequency] ?? 3;
    const items = tools.slice(-limit);
    lines.push("", "*Latest actions*");
    for (const tool of items) {
      const detail = buildClaudeToolDetail(tool, workingPath);
      lines.push(`${getToolIcon(tool.status)} \`${tool.name}\`${detail ? ` ${detail}` : ""}`);
    }
  }

  return lines.join("\n");
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
    buildStatusMessage({ request, workingPath, state, frequency }) {
      const providerId = getProviderForSession(request.sessionId);
      if (providerId === "claude") {
        return buildClaudeStatusMessage(request, workingPath, state, frequency);
      }
      return buildLiveStatusMessage(request, workingPath, state, frequency);
    },
  };
}
