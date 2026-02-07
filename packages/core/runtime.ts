import {
  DEFAULT_CODEX_MODEL,
  getChannelModel,
  resolveMessageFrequency,
} from "@/config";
import {
  loadSession,
  failActiveRequest,
  clearActiveRequest,
  isMessageProcessed,
  markMessageProcessed,
  getPendingQuestion,
} from "@/config/local/sessions";
import {
  type SessionEvent,
  type SessionMessageState,
  log,
} from "@/utils";
import { CoreStateMachine } from "@/core/state-machine";
import type { AgentAdapter, CoreMessageContext, IMAdapter } from "@/core/types";
import { ThreadMessageQueue } from "@/core/runtime/thread-queue";
import { handlePendingQuestionReply } from "@/core/runtime/pending-question";
import { recoverPendingRequests as recoverPendingRequestsInternal } from "@/core/runtime/recovery";
import { prepareRuntimeSession } from "@/core/runtime/session-bootstrap";
import { runOpenRequest } from "@/core/runtime/open-request";
import type { OpenCodeOptions } from "@/agents";

type RuntimeDeps = {
  im: IMAdapter;
  agent: AgentAdapter;
};

type RuntimeState = {
  liveEventHistory: Map<string, SessionEvent[]>;
  liveParsedState: Map<string, SessionMessageState>;
  stateMachines: Map<string, CoreStateMachine>;
};

function createRuntimeState(): RuntimeState {
  return {
    liveEventHistory: new Map(),
    liveParsedState: new Map(),
    stateMachines: new Map(),
  };
}

export function createCoreRuntime(deps: RuntimeDeps) {
  const state = createRuntimeState();

  function getStateKey(context: { channelId: string; threadId: string }): string {
    return `${context.channelId}:${context.threadId}`;
  }

  function getStateMachine(context: { channelId: string; threadId: string }): CoreStateMachine {
    const key = getStateKey(context);
    const existing = state.stateMachines.get(key);
    if (existing) return existing;
    const machine = new CoreStateMachine(key);
    state.stateMachines.set(key, machine);
    return machine;
  }

  const threadQueue = new ThreadMessageQueue<CoreMessageContext>({
    getKey: (context) => `${context.channelId}-${context.threadId}`,
    process: (context, text) => handleUserMessageInternal(context, text),
  });

  async function publishFinalText(params: {
    channelId: string;
    threadId: string;
    statusTs: string;
    text: string;
  }): Promise<void> {
    const { channelId, threadId, statusTs, text } = params;
    if (resolveMessageFrequency() === "aggressive") {
      await deps.im.sendMessage(channelId, threadId, text, true);
      return;
    }

    if (text.length > 2800) {
      await deps.im.updateMessage(channelId, statusTs, "_Response posted below._", false);
      await deps.im.sendMessage(channelId, threadId, text, true);
      return;
    }

    await deps.im.updateMessage(channelId, statusTs, text, true);
  }

  async function handleUserMessageInternal(context: CoreMessageContext, text: string): Promise<void> {
    const { channelId, threadId } = context;
    const stateMachine = getStateMachine(context);
    const prepared = await prepareRuntimeSession({
      deps,
      context,
      stateMachine,
    });
    if (!prepared) return;

    const { session, sessionId, created, cwd, threadOwnerUserId } = prepared;

    const threadHistory = created
      ? await deps.im.fetchThreadHistory(channelId, threadId, context.messageId)
      : null;

    const agentContext = await deps.im.buildAgentContext({
      cwd,
      channelId,
      threadId,
      userId: threadOwnerUserId,
      threadHistory,
    });

    const trimmed = text.trim();
    const agent = /^plan\b/i.test(trimmed) ? "plan" : undefined;
    const providerId = deps.agent.getProviderForSession(sessionId);
    const channelModel = getChannelModel(channelId)?.trim();
    const codexModel = providerId === "codex"
      ? (channelModel && channelModel.length > 0 ? channelModel : DEFAULT_CODEX_MODEL)
      : undefined;
    const options: OpenCodeOptions | undefined = agent || codexModel
      ? {
          ...(agent ? { agent } : {}),
          ...(codexModel ? { model: { providerID: "openai", modelID: codexModel } } : {}),
        }
      : undefined;

    const responses = await runOpenRequest({
      deps,
      session,
      context,
      sessionId,
      cwd,
      message: text,
      phaseLabel: "Working",
      stateMachine,
      agentContext,
      options,
      liveEventHistory: state.liveEventHistory,
      liveParsedState: state.liveParsedState,
      publishFinalText,
    });

    if (!responses) return;
  }

  async function handleIncomingMessage(context: CoreMessageContext, text: string): Promise<void> {
    if (isMessageProcessed(context.messageId)) {
      log.debug("Skipping duplicate message", { messageId: context.messageId });
      return;
    }

    const pendingQuestion = getPendingQuestion(context.channelId, context.threadId);
    if (pendingQuestion) {
      const handled = await handlePendingQuestionReply({
        deps,
        pendingQuestion,
        context,
        text,
      });
      if (handled) {
        return;
      }
    }

    markMessageProcessed(context.messageId);
    threadQueue.enqueue(context, text);
  }

  async function handleStopCommand(channelId: string, threadId: string): Promise<boolean> {
    const session = loadSession(channelId, threadId);
    if (!session?.activeRequest || session.activeRequest.state !== "processing") {
      return false;
    }

    const request = session.activeRequest;
    log.info("Stop command received", { sessionId: request.sessionId });

    try {
      const cwd = session.workingDirectory;
      await deps.agent.abortSession(request.sessionId, cwd);
    } catch {
      // Ignore abort errors
    }

    request.state = "failed";
    request.error = "Stopped by user";

    await deps.im.deleteMessage(channelId, request.statusMessageTs);

    failActiveRequest(channelId, threadId, "Stopped by user");
    return true;
  }

  async function handleButtonSelection(params: {
    channelId: string;
    threadId: string;
    userId: string;
    selection: string;
    messageTs: string;
  }): Promise<void> {
    const { channelId, threadId, userId, selection, messageTs } = params;
    await handleIncomingMessage(
      {
        channelId,
        threadId,
        userId,
        messageId: messageTs,
      },
      selection
    );
  }

  async function recoverPendingRequests(): Promise<void> {
    await recoverPendingRequestsInternal(deps.im);
  }

  return {
    handleIncomingMessage,
    handleStopCommand,
    handleButtonSelection,
    recoverPendingRequests,
  };
}
