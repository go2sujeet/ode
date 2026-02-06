import {
  completeActiveRequest,
  createActiveRequest,
  failActiveRequest,
  isMessageProcessed,
  loadSession,
  markMessageProcessed,
  saveSession,
} from "@/config/local/sessions";
import { resolveMessageFrequency } from "@/config/message-frequency";
import { runTrackedRequest } from "@/core/runtime/request-runner";
import { CoreStateMachine } from "@/core/state-machine";
import type { AgentAdapter, IMAdapter } from "@/core/types";
import { buildLiveStatusMessage, getStatusMessageKey, type SessionEvent, type SessionMessageState, log } from "@/utils";

type SelectionDeps = {
  im: IMAdapter;
  agent: AgentAdapter;
};

type HandleSelectionReplyParams = {
  deps: SelectionDeps;
  state: {
    liveEventHistory: Map<string, SessionEvent[]>;
    liveParsedState: Map<string, SessionMessageState>;
  };
  channelId: string;
  threadId: string;
  userId: string;
  selection: string;
  messageTs: string;
  cwd: string;
  shouldStoreEvents: boolean;
  getStateMachine: (context: { channelId: string; threadId: string }) => CoreStateMachine;
  publishFinalText: (params: {
    channelId: string;
    threadId: string;
    statusTs: string;
    text: string;
  }) => Promise<void>;
};

export async function handleSelectionReply(params: HandleSelectionReplyParams): Promise<void> {
  const {
    deps,
    state,
    channelId,
    threadId,
    userId,
    selection,
    messageTs,
    cwd,
    shouldStoreEvents,
    getStateMachine,
    publishFinalText,
  } = params;

  const sessionId = loadSession(channelId, threadId)?.sessionId;
  if (!sessionId) {
    log.warn("No session found for button selection", { channelId, threadId });
    return;
  }

  if (isMessageProcessed(messageTs)) {
    log.debug("Skipping duplicate button selection", { messageTs });
    return;
  }
  markMessageProcessed(messageTs);

  const statusTs = await deps.im.sendMessage(channelId, threadId, "_Processing..._", false);
  if (!statusTs) {
    log.error("Failed to send status message for button selection");
    return;
  }

  const request = createActiveRequest(sessionId, channelId, threadId, statusTs, selection);

  const session = loadSession(channelId, threadId);
  if (session) {
    session.activeRequest = request;
    if (!session.threadOwnerUserId) {
      session.threadOwnerUserId = userId;
    }
    saveSession(session);
  }

  const threadOwnerUserId = session?.threadOwnerUserId ?? userId;
  const agent = /^plan\b/i.test(selection.trim()) ? "plan" : undefined;

  const agentContext = await deps.im.buildAgentContext({
    cwd,
    channelId,
    threadId,
    userId: threadOwnerUserId,
  });

  await runTrackedRequest({
    deps,
    request,
    statusTs,
    workingPath: cwd,
    stateMachine: getStateMachine({ channelId, threadId }),
    liveEventHistory: state.liveEventHistory,
    liveParsedState: state.liveParsedState,
    shouldStoreEvents,
    sendPrompt: () =>
      deps.agent.sendMessage(
        channelId,
        sessionId,
        `User selected: ${selection}`,
        cwd,
        agent ? { agent } : undefined,
        agentContext
      ),
    onProgressTick: async () => {
      const statusText = buildLiveStatusMessage(
        request,
        cwd,
        state.liveParsedState.get(getStatusMessageKey(request)),
        resolveMessageFrequency()
      );
      await deps.im.updateMessage(channelId, statusTs, statusText, false);
    },
    onComplete: () => {
      completeActiveRequest(channelId, threadId);
    },
    onFail: (message) => {
      failActiveRequest(channelId, threadId, message);
    },
    publishFinalText: async (text) => {
      await publishFinalText({ channelId, threadId, statusTs, text });
    },
    failureLogLabel: "Button selection handling failed",
  });
}
