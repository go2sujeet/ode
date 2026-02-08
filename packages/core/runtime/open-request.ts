import { resolveStatusMessageFormat } from "@/config/status-message-format";
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
import { CoreStateMachine } from "@/core/state-machine";
import type { OpenCodeOptions } from "@/agents";
import type { AgentAdapter, CoreMessageContext, IMAdapter } from "@/core/types";
import { getStatusMessageKey, type SessionEvent, type SessionMessageState, log } from "@/utils";

type OpenRequestDeps = {
  im: IMAdapter;
  agent: AgentAdapter;
};

export async function runOpenRequest(params: {
  deps: OpenRequestDeps;
  session: PersistedSession;
  context: CoreMessageContext;
  sessionId: string;
  cwd: string;
  message: string;
  phaseLabel: string;
  stateMachine: CoreStateMachine;
  agentContext: Awaited<ReturnType<IMAdapter["buildAgentContext"]>>;
  options?: OpenCodeOptions;
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
    phaseLabel,
    stateMachine,
    agentContext,
    options,
    liveEventHistory,
    liveParsedState,
    publishFinalText,
  } = params;

  const statusTs = await deps.im.sendMessage(
    context.channelId,
    context.threadId,
    `_${phaseLabel}..._`,
    false
  );

  if (!statusTs) {
    log.error("Failed to send status message");
    return null;
  }

  const request = createActiveRequest(sessionId, context.channelId, context.threadId, statusTs, message);
  session.activeRequest = request;
  saveSession(session);

  let lastHeartbeat = Date.now();
  const result = await runTrackedRequest({
    deps,
    request,
    statusTs,
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
      if (now - lastHeartbeat > 5000) {
        lastHeartbeat = now;
        request.lastUpdatedAt = now;
      }

      const statusText = buildStatusMessageForAgent({
        agent: deps.agent,
        request,
        workingPath: cwd,
        state: liveParsedState.get(getStatusMessageKey(request)),
        statusMessageFormat: resolveStatusMessageFormat(),
      });
      if (!request.statusFrozen) {
        await deps.im.updateMessage(context.channelId, statusTs, statusText, false);
      }
      updateActiveRequest(context.channelId, context.threadId, {
        currentText: request.currentText,
        tools: request.tools,
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
        threadId: context.threadId,
        statusTs,
        text,
      });
    },
    failureLogLabel: "Request failed",
  });

  if (result.responses === null) return null;
  if (result.stopFallbackText) {
    return [{ text: result.stopFallbackText, messageType: "assistant" }];
  }
  return result.responses;
}
