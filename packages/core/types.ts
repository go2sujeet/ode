import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "@/agents";
import type { StatusMessageFormat } from "@/config";
import type { AgentProviderId } from "@/shared/agent-provider";
import type { SessionMessageState } from "@/utils/session-inspector";

export type AgentContextBuilderParams = {
  cwd: string;
  channelId: string;
  replyThreadId: string;
  threadId: string;
  userId: string;
  threadHistory?: string | null;
};

export type NormalizedQuestion = {
  question: string;
  options?: string[];
  multiple?: boolean;
  custom?: boolean;
};

export type StatusMessageRequest = {
  sessionId: string;
  channelId: string;
  threadId: string;
  statusMessageTs: string;
  startedAt: number;
  currentText: string;
  statusFrozen?: boolean;
};

export type AgentStatusMessageParams = {
  request: StatusMessageRequest;
  workingPath: string;
  state?: SessionMessageState;
  statusMessageFormat: StatusMessageFormat;
};

export interface IMAdapter {
  maxEditableMessageChars?: number;
  sendMessage(channelId: string, threadId: string, text: string): Promise<string | undefined>;
  /**
   * Optional. When present, the runtime calls this for ask_user-style prompts
   * so the IM can render interactive UI (e.g. Slack buttons) when the options
   * are simple enough. Implementations are free to fall back to plain text.
   * `prefix` is an optional leading marker like "(1/2) " for multi-question
   * flows.
   */
  sendQuestion?(
    channelId: string,
    threadId: string,
    question: string,
    options: string[] | undefined,
    prefix?: string
  ): Promise<string | undefined>;
  updateMessage(
    channelId: string,
    messageTs: string,
    text: string
  ): Promise<string | undefined | void>;
  wasRateLimited?(channelId: string, messageTs: string): boolean;
  getRateLimitError?(channelId: string, messageTs: string): string | undefined;
  takeUpdateError?(channelId: string, messageTs: string): string | undefined;
  cancelPendingUpdates?(channelId: string, messageTs: string): void;
  markMessageFinalized?(channelId: string, messageTs: string): void;
  deleteMessage(channelId: string, messageTs: string): Promise<void>;
  fetchThreadHistory(channelId: string, threadId: string, messageId: string): Promise<string | null>;
  buildAgentContext(params: AgentContextBuilderParams): Promise<OpenCodeMessageContext>;
  renameThread?(channelId: string, threadId: string, name: string): Promise<void>;
}

export interface AgentAdapter {
  supportsEventStream: boolean;
  getProviderForSession(sessionId: string): AgentProviderId;
  getDisplayNameForSession(sessionId: string): string;
  getOrCreateSession(
    channelId: string,
    threadId: string,
    cwd: string,
    env: Record<string, string>
  ): Promise<OpenCodeSessionInfo>;
  sendMessage(
    channelId: string,
    sessionId: string,
    message: string,
    cwd: string,
    options?: OpenCodeOptions,
    context?: OpenCodeMessageContext
  ): Promise<OpenCodeMessage[]>;
  abortSession(sessionId: string, directory?: string): Promise<void>;
  ensureSession(sessionId: string): Promise<void>;
  subscribeToSession(sessionId: string, handler: (event: unknown) => void): () => void;
  replyToQuestion(params: {
    requestId: string;
    sessionId: string;
    directory?: string;
    answers: Array<Array<string>>;
  }): Promise<void>;
  normalizeQuestions(questions: unknown): NormalizedQuestion[];
  buildStatusMessage?(params: AgentStatusMessageParams): string;
}
