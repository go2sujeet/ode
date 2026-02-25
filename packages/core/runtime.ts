import { spawnSync } from "child_process";
import {
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
import { buildMessageOptions } from "@/core/runtime/message-options";
import { splitResultMessage } from "@/core/runtime/result-message";
import { createRateLimitedImAdapter } from "@/core/runtime/message-updates";
import type { OpenCodeOptions } from "@/agents";

type RuntimeDeps = {
  platform: "slack" | "discord" | "lark";
  im: IMAdapter;
  agent: AgentAdapter;
};

type RuntimeState = {
  liveEventHistory: Map<string, SessionEvent[]>;
  liveParsedState: Map<string, SessionMessageState>;
  stateMachines: Map<string, CoreStateMachine>;
};

type BranchCacheEntry = {
  value: string | null;
  expiresAt: number;
};

const BRANCH_CACHE_TTL_MS = 30_000;
const BRANCH_CACHE_MISS_TTL_MS = 5_000;
const GIT_BRANCH_TIMEOUT_MS = 1_500;
const branchNameCache = new Map<string, BranchCacheEntry>();

function createRuntimeState(): RuntimeState {
  return {
    liveEventHistory: new Map(),
    liveParsedState: new Map(),
    stateMachines: new Map(),
  };
}

function getCachedBranchName(cwd: string): string | null | undefined {
  const entry = branchNameCache.get(cwd);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    branchNameCache.delete(cwd);
    return undefined;
  }
  return entry.value;
}

function setCachedBranchName(cwd: string, value: string | null): void {
  branchNameCache.set(cwd, {
    value,
    expiresAt: Date.now() + (value ? BRANCH_CACHE_TTL_MS : BRANCH_CACHE_MISS_TTL_MS),
  });
}

function resolveBranchNameFromGit(cwd: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    env: { ...process.env },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_BRANCH_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });

  if (result.error) {
    log.debug("Failed resolving git branch name", { cwd, error: String(result.error) });
    return null;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    return null;
  }

  const name = result.stdout.trim();
  if (!name || name === "HEAD") {
    return null;
  }

  return name;
}

function getCurrentBranchName(cwd: string): string | null {
  const cached = getCachedBranchName(cwd);
  if (cached !== undefined) return cached;

  const name = resolveBranchNameFromGit(cwd);
  setCachedBranchName(cwd, name);
  return name;
}

async function maybeSyncBranchAndThread(params: {
  session: PersistedSession;
  cwd: string;
}): Promise<void> {
  const { session, cwd } = params;
  const branchName = getCurrentBranchName(cwd);
  if (!branchName) return;

  let updated = false;
  if (session.branchName !== branchName) {
    session.branchName = branchName;
    updated = true;
  }

  if (updated) {
    saveSession(session);
  }
}

export function createCoreRuntime(deps: RuntimeDeps) {
  const runtimeDeps: RuntimeDeps = {
    ...deps,
    im: createRateLimitedImAdapter(deps.im),
  };
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
    const statusFormat = resolveStatusMessageFormat();
    const finalChunks = splitResultMessage(text);
    const singleChunk = finalChunks[0] ?? text;
    const statusRateLimited = runtimeDeps.im.wasRateLimited?.(channelId, statusTs) ?? false;
    const statusRateLimitError = runtimeDeps.im.getRateLimitError?.(channelId, statusTs);

    if (finalChunks.length > 1) {
      if (statusFormat !== "aggressive" && !statusRateLimited) {
        await runtimeDeps.im.updateMessage(channelId, statusTs, "Final result posted below in multiple messages.");
      } else if (statusRateLimited) {
        log.warn("Skipping final status update due to prior 429; posting final chunks as new messages", {
          channelId,
          threadId,
          statusTs,
          ...(statusRateLimitError ? { error: statusRateLimitError } : {}),
        });
      }

      for (const chunk of finalChunks) {
        await runtimeDeps.im.sendMessage(channelId, threadId, chunk);
      }
      return;
    }

    if (statusFormat === "aggressive") {
      await runtimeDeps.im.sendMessage(channelId, threadId, singleChunk);
      return;
    }

    if (statusRateLimited) {
      log.warn("Skipping final status edit due to prior 429; posting final result as new message", {
        channelId,
        threadId,
        statusTs,
        ...(statusRateLimitError ? { error: statusRateLimitError } : {}),
      });
      await runtimeDeps.im.sendMessage(channelId, threadId, singleChunk);
      return;
    }

    const maxEditableMessageChars = runtimeDeps.im.maxEditableMessageChars;
    if (typeof maxEditableMessageChars === "number" && singleChunk.length > maxEditableMessageChars) {
      await runtimeDeps.im.updateMessage(channelId, statusTs, "Final result posted below.");
      await runtimeDeps.im.sendMessage(channelId, threadId, singleChunk);
      return;
    }

    await runtimeDeps.im.updateMessage(channelId, statusTs, singleChunk);
  }

  async function handleUserMessageInternal(context: CoreMessageContext, text: string): Promise<void> {
    const { channelId, replyThreadId, threadId } = context;
    const stateMachine = getStateMachine(context);
    const prepared = await prepareRuntimeSession({
      deps: runtimeDeps,
      context,
      stateMachine,
    });
    if (!prepared) return;

    const { session, sessionId, created, cwd, threadOwnerUserId } = prepared;

    await maybeSyncBranchAndThread({
      session,
      cwd,
    });

    const threadHistory = created
      ? await runtimeDeps.im.fetchThreadHistory(channelId, replyThreadId, context.messageId)
      : null;

    const agentContext = await runtimeDeps.im.buildAgentContext({
      cwd,
      channelId,
      replyThreadId,
      threadId,
      userId: threadOwnerUserId,
      threadHistory,
    });

    const providerId = deps.agent.getProviderForSession(sessionId);
    const options: OpenCodeOptions | undefined = buildMessageOptions({
      text,
      channelId,
      providerId,
    });

    const responses = await runOpenRequest({
      deps: {
        ...runtimeDeps,
        platform: deps.platform,
      },
      session,
      context,
      sessionId,
      cwd,
      message: text,
      isFirstMessageInThread: created,
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
        deps: runtimeDeps,
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
    if (!session) {
      log.info("Stop command received without session", { channelId, threadId });
      return true;
    }

    const request = session.activeRequest;
    log.info("Stop command received", {
      sessionId: request?.sessionId ?? session.sessionId,
      hadActiveRequest: Boolean(request),
      activeState: request?.state ?? null,
    });

    try {
      const cwd = session.workingDirectory;
      await deps.agent.abortSession(session.sessionId, cwd);
    } catch {
      // Ignore abort errors
    }

    if (!request || request.state !== "processing") {
      return true;
    }

    request.state = "failed";
    request.error = "Stopped by user";

    await runtimeDeps.im.deleteMessage(request.channelId, request.statusMessageTs);

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
    await recoverPendingRequestsInternal(runtimeDeps.im, deps.platform);
  }

  return {
    handleIncomingMessage,
    handleStopCommand,
    handleButtonSelection,
    recoverPendingRequests,
  };
}
