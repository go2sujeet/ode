import { spawnSync } from "child_process";
import {
  DEFAULT_CODEX_MODEL,
  getChannelModel,
  resolveStatusMessageFormat,
} from "@/config";
import {
  loadSession,
  saveSession,
  failActiveRequest,
  isMessageProcessed,
  markMessageProcessed,
  getPendingQuestion,
  type PersistedSession,
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

function toKiloModel(modelValue: string | null | undefined): OpenCodeOptions["model"] | undefined {
  const trimmed = modelValue?.trim();
  if (!trimmed) return undefined;
  const [providerID = "kilo", ...rest] = trimmed.split("/");
  if (rest.length === 0) {
    return { providerID: "kilo", modelID: trimmed };
  }
  return { providerID, modelID: rest.join("/") };
}

function createRuntimeState(): RuntimeState {
  return {
    liveEventHistory: new Map(),
    liveParsedState: new Map(),
    stateMachines: new Map(),
  };
}

function getCurrentBranchName(cwd: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      env: { ...process.env },
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      return null;
    }
    const name = String(result.stdout || "").trim();
    if (!name || name === "HEAD") {
      return null;
    }
    return name;
  } catch {
    return null;
  }
}

async function maybeSyncBranchAndThread(params: {
  session: PersistedSession;
  cwd: string;
  channelId: string;
  threadId: string;
  replyThreadId: string;
  im: IMAdapter;
}): Promise<void> {
  const { session, cwd, channelId, threadId, replyThreadId, im } = params;
  const branchName = getCurrentBranchName(cwd);
  if (!branchName) return;

  let updated = false;
  if (session.branchName !== branchName) {
    session.branchName = branchName;
    updated = true;
  }

  const looksDefault = branchName.startsWith("ode_") || branchName === `ode_${threadId}`;
  if (
    typeof im.renameThread === "function" &&
    replyThreadId &&
    !looksDefault &&
    session.threadNameSyncedWithBranch !== branchName
  ) {
    try {
      await im.renameThread(channelId, replyThreadId, branchName);
      session.threadNameSyncedWithBranch = branchName;
      updated = true;
    } catch (error) {
      log.warn("Failed to sync thread name with branch", {
        channelId,
        threadId,
        branchName,
        error: String(error),
      });
    }
  }

  if (updated) {
    saveSession(session);
  }
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
    if (resolveStatusMessageFormat() === "aggressive") {
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
    const { channelId, replyThreadId, threadId } = context;
    const stateMachine = getStateMachine(context);
    const prepared = await prepareRuntimeSession({
      deps,
      context,
      stateMachine,
    });
    if (!prepared) return;

    const { session, sessionId, created, cwd, threadOwnerUserId } = prepared;

    await maybeSyncBranchAndThread({
      session,
      cwd,
      channelId,
      threadId,
      replyThreadId,
      im: deps.im,
    });

    const threadHistory = created
      ? await deps.im.fetchThreadHistory(channelId, replyThreadId, context.messageId)
      : null;

    const agentContext = await deps.im.buildAgentContext({
      cwd,
      channelId,
      replyThreadId,
      threadId,
      userId: threadOwnerUserId,
      threadHistory,
    });

    const normalizedText = text.trimStart().toLowerCase();
    const agent = /^plan\b/.test(normalizedText) ? "plan" : undefined;
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
    if (isMessageProcessed(context.channelId, context.threadId, context.messageId)) {
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

    markMessageProcessed(context.channelId, context.threadId, context.messageId);
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

    await deps.im.deleteMessage(request.channelId, request.statusMessageTs);

    failActiveRequest(channelId, threadId, "Stopped by user");
    return true;
  }

  async function handleButtonSelection(params: {
    channelId: string;
    replyThreadId: string;
    threadId: string;
    userId: string;
    selection: string;
    messageTs: string;
  }): Promise<void> {
    const { channelId, replyThreadId, threadId, userId, selection, messageTs } = params;
    await handleIncomingMessage(
      {
        channelId,
        replyThreadId,
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
