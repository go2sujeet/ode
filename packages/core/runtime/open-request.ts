import { resolveStatusMessageFormat } from "@/config/status-message-format";
import { resolveMessageUpdateIntervalMs } from "@/config/message-update-interval";
import {
  completeActiveRequest,
  createActiveRequest,
  failActiveRequest,
  saveSession,
  updateActiveRequest,
  type PersistedSession,
} from "@/config/local/sessions";
import { runTrackedRequest } from "@/core/runtime/request-runner";
import { buildStatusMessageForAgent } from "@/core/runtime/status-message";
import { maybeGenerateSessionTitle } from "@/core/runtime/session-title";
import { CoreStateMachine } from "@/core/state-machine";
import type { OpenCodeOptions } from "@/agents";
import type { AgentAdapter, CoreMessageContext, IMAdapter } from "@/core/types";
import { getStatusMessageKey, type SessionEvent, type SessionMessageState, log } from "@/utils";

type OpenRequestDeps = {
  im: IMAdapter;
  agent: AgentAdapter;
  platform: "slack" | "discord" | "lark";
};

export async function runOpenRequest(params: {
  deps: OpenRequestDeps;
  session: PersistedSession;
  context: CoreMessageContext;
  sessionId: string;
  cwd: string;
  message: string;
  stateMachine: CoreStateMachine;
  agentContext: Awaited<ReturnType<IMAdapter["buildAgentContext"]>>;
  options?: OpenCodeOptions;
  isFirstMessageInThread: boolean;
  liveEventHistory: Map<string, SessionEvent[]>;
  liveParsedState: Map<string, SessionMessageState>;
  publishFinalText: (params: {
    channelId: string;
    threadId: string;
    statusTs: string;
    text: string;
  }) => Promise<void>;
}): Promise<Array<{ text: string; messageType: "assistant" | "result" | "system" | "user" | "notify" }> | null> {
  const {
    deps,
    session,
    context,
    sessionId,
    cwd,
    message,
    stateMachine,
    agentContext,
    options,
    isFirstMessageInThread,
    liveEventHistory,
    liveParsedState,
    publishFinalText,
  } = params;

  const providerLabel = deps.agent.getDisplayNameForSession(sessionId);

  const initialStatusTs = await deps.im.sendMessage(
    context.channelId,
    context.replyThreadId,
    `${providerLabel} is running...`
  );

  if (!initialStatusTs) {
    log.error("Failed to send status message");
    return null;
  }
  let statusTs = initialStatusTs;

  const request = createActiveRequest(
    sessionId,
    context.channelId,
    context.replyThreadId,
    context.threadId,
    statusTs,
    message
  );
  session.activeRequest = request;
  saveSession(session);

  const statusMessageKey = getStatusMessageKey(request);
  const triggerThreadRenameFromTitle = () => {
    void maybeGenerateSessionTitle({
      prompt: message,
      stateKey: statusMessageKey,
      liveParsedState,
      startedAt: request.startedAt,
    });
  };

  const progressIntervalMs = resolveMessageUpdateIntervalMs();
  let lastHeartbeat = Date.now();
  const result = await runTrackedRequest({
    deps,
    request,
    workingPath: cwd,
    stateMachine,
    liveEventHistory,
    liveParsedState,
    sendPrompt: () =>
      deps.agent.sendMessage(
        context.channelId,
        sessionId,
        message,
        cwd,
        options,
        agentContext
      ),
    onProgressTick: async () => {
      const now = Date.now();
      if (now - lastHeartbeat > progressIntervalMs) {
        lastHeartbeat = now;
        request.lastUpdatedAt = now;
      }

      const statusText = buildStatusMessageForAgent({
        agent: deps.agent,
        request,
        workingPath: cwd,
        state: liveParsedState.get(statusMessageKey),
        statusMessageFormat: resolveStatusMessageFormat(),
      });
      if (!request.statusFrozen) {
        const updatedStatusTs = await deps.im.updateMessage(context.channelId, statusTs, statusText);
        if (typeof updatedStatusTs === "string" && updatedStatusTs !== statusTs) {
          statusTs = updatedStatusTs;
          request.statusMessageTs = updatedStatusTs;
        }
      }
      updateActiveRequest(context.channelId, context.threadId, {
        statusMessageTs: request.statusMessageTs,
        currentText: request.currentText,
        todos: request.todos,
        statusFrozen: request.statusFrozen,
      });
    },
    onComplete: () => {
      completeActiveRequest(context.channelId, context.threadId);
    },
    onFail: (failureMessage) => {
      failActiveRequest(context.channelId, context.threadId, failureMessage);
    },
    publishFinalText: async (text) => {
      await publishFinalText({
        channelId: context.channelId,
        threadId: context.replyThreadId,
        statusTs,
        text,
      });
    },
    failureLogLabel: "Request failed",
  });

  if (result.responses === null) return null;

  if (deps.platform === "discord" && isFirstMessageInThread) {
    triggerThreadRenameFromTitle();
  }

  if (result.stopFallbackText) {
    return [{ text: result.stopFallbackText, messageType: "assistant" }];
  }
  return result.responses;
}
