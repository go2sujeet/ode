import {
  completeActiveRequest,
  createActiveRequest,
  failActiveRequest,
  isMessageProcessed,
  loadSession,
  markMessageProcessed,
  saveSession,
} from "@/config/local/sessions";
import { DEFAULT_CODEX_MODEL, getChannelModel, resolveStatusMessageFormat } from "@/config";
import { runTrackedRequest } from "@/core/runtime/request-runner";
import { buildStatusMessageForAgent } from "@/core/runtime/status-message";
import { CoreStateMachine } from "@/core/state-machine";
import type { OpenCodeOptions } from "@/agents";
import type { AgentAdapter, IMAdapter } from "@/core/types";
import { getStatusMessageKey, type SessionEvent, type SessionMessageState, log } from "@/utils";

type SelectionDeps = {
  im: IMAdapter;
  agent: AgentAdapter;
};

function toKiloModel(modelValue: string | null | undefined): OpenCodeOptions["model"] | undefined {
  const trimmed = modelValue?.trim();
  if (!trimmed) return undefined;
  const [providerID = "kilo", ...rest] = trimmed.split("/");
  if (rest.length === 0) {
    return { providerID: "kilo", modelID: trimmed };
  }
  return { providerID, modelID: rest.join("/") };
}

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
    getStateMachine,
    publishFinalText,
  } = params;

  const sessionId = loadSession(channelId, threadId)?.sessionId;
  if (!sessionId) {
    log.warn("No session found for button selection", { channelId, threadId });
    return;
  }

  if (isMessageProcessed(channelId, threadId, messageTs)) {
    log.debug("Skipping duplicate button selection", { messageTs });
    return;
  }
  markMessageProcessed(channelId, threadId, messageTs);

  const statusTs = await deps.im.sendMessage(channelId, threadId, "_Processing..._", false);
  if (!statusTs) {
    log.error("Failed to send status message for button selection");
    return;
  }

  const request = createActiveRequest(sessionId, channelId, threadId, threadId, statusTs, selection);

  const session = loadSession(channelId, threadId);
  if (session) {
    session.activeRequest = request;
    if (!session.threadOwnerUserId) {
      session.threadOwnerUserId = userId;
    }
    saveSession(session);
  }

  const threadOwnerUserId = session?.threadOwnerUserId ?? userId;
  const normalizedSelection = selection.trimStart().toLowerCase();
  const agent = /^plan\b/.test(normalizedSelection) ? "plan" : undefined;
  const providerId = deps.agent.getProviderForSession(sessionId);
  const channelModel = getChannelModel(channelId)?.trim();
  const codexModel = providerId === "codex"
    ? (channelModel && channelModel.length > 0 ? channelModel : DEFAULT_CODEX_MODEL)
    : undefined;
  const kiloModel = providerId === "kilo" ? toKiloModel(channelModel) : undefined;
  const options: OpenCodeOptions | undefined = agent || codexModel || kiloModel
    ? {
        ...(agent ? { agent } : {}),
        ...(codexModel ? { model: { providerID: "openai", modelID: codexModel } } : {}),
        ...(kiloModel ? { model: kiloModel } : {}),
      }
    : undefined;

  const agentContext = await deps.im.buildAgentContext({
    cwd,
    channelId,
    replyThreadId: threadId,
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
    sendPrompt: () =>
      deps.agent.sendMessage(
        channelId,
        sessionId,
        `User selected: ${selection}`,
        cwd,
        options,
        agentContext
      ),
    onProgressTick: async () => {
      const statusText = buildStatusMessageForAgent({
        agent: deps.agent,
        request,
        workingPath: cwd,
        state: state.liveParsedState.get(getStatusMessageKey(request)),
        statusMessageFormat: resolveStatusMessageFormat(),
      });
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
