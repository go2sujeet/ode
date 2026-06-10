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

/**
 * Chunk emitted by the status-stream renderer. Mirrors the shape of Slack's
 * `chat.appendStream` `chunks` payload, but kept platform-agnostic so other
 * IM adapters can choose their own rendering (or ignore it).
 *
 * - `task_update`: one tool / step card. `id` is a stable per-tool key, status
 *   transitions from `pending` → `in_progress` → `complete`/`error`.
 * - `plan_update`: rename the surrounding plan container (e.g. session title
 *   or phase label).
 * - `markdown_text`: free-form markdown chunk appended to the stream body.
 */
export type StatusStreamChunk =
  | {
      type: "task_update";
      id: string;
      title: string;
      status: "pending" | "in_progress" | "complete" | "error";
      details?: string;
      output?: string;
      sources?: Array<{ type: "url"; text: string; url: string }>;
    }
  | { type: "plan_update"; title: string }
  | { type: "markdown_text"; text: string };

export interface IMAdapter {
  maxEditableMessageChars?: number;
  sendMessage(channelId: string, threadId: string, text: string): Promise<string | undefined>;
  /**
   * Optional. When implemented, the runtime uses Slack's (or equivalent)
   * Streaming API to render live status updates — `task_update` /
   * `plan_update` chunks render as animated task cards instead of repeated
   * `chat.update` calls against a plain-text message.
   *
   * Channel (non-DM) streams on Slack require the requesting user's id and
   * team id; pass them on `startStatusStream` and the adapter forwards.
   *
   * Lifecycle: `startStatusStream` once → many `appendStatusStream` calls →
   * one `stopStatusStream` (or fall back to `updateMessage` if the stream
   * was never started for this message TS).
   *
   * Slack-specific quirk: the stream is mode-locked to "chunks" at start;
   * `appendStatusStream` / `stopStatusStream` cannot mix in plain markdown.
   */
  startStatusStream?(
    channelId: string,
    threadId: string,
    opts: { recipientUserId: string; seedPlanTitle?: string }
  ): Promise<string | undefined>;
  appendStatusStream?(
    channelId: string,
    messageTs: string,
    chunks: StatusStreamChunk[]
  ): Promise<void>;
  stopStatusStream?(channelId: string, messageTs: string): Promise<void>;
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
