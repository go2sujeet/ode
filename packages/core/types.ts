import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "@/agents";
import type { StatusMessageFormat } from "@/config/status-message-format";
import type { SessionMessageState } from "@/utils/session-inspector";

export type CoreMessageContext = {
  channelId: string;
  threadId: string;
  userId: string;
  messageId: string;
  workspaceName?: string;
};

export type AgentContextBuilderParams = {
  cwd: string;
  channelId: string;
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
  sendMessage(channelId: string, threadId: string, text: string, asMarkdown?: boolean): Promise<string | undefined>;
  updateMessage(channelId: string, messageTs: string, text: string, asMarkdown?: boolean): Promise<void>;
  deleteMessage(channelId: string, messageTs: string): Promise<void>;
  fetchThreadHistory(channelId: string, threadId: string, messageId: string): Promise<string | null>;
  buildAgentContext(params: AgentContextBuilderParams): Promise<OpenCodeMessageContext>;
}

export interface AgentAdapter {
  supportsEventStream: boolean;
  getProviderForSession(sessionId: string): "opencode" | "claudecode" | "codex" | "kimi";
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
