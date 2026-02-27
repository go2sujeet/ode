import { spawnSync } from "child_process";
import {
  getUserGeneralSettings,
} from "@/config";
import {
  loadSession,
  saveSession,
  failActiveRequest,
  isMessageProcessed,
  markMessageProcessed,
  markThreadActive,
  getPendingQuestion,
  type PersistedSession,
} from "@/config/local/sessions";
import {
  type SessionEvent,
  type SessionMessageState,
  log,
} from "@/utils";
import type { AgentAdapter, IMAdapter } from "@/core/types";
import { handlePendingQuestionReply } from "@/core/kernel/pending-question";
import { recoverPendingRequests as recoverPendingRequestsInternal } from "@/core/runtime/recovery";
import { prepareRuntimeSession } from "@/core/kernel/session-bootstrap";
import { runOpenRequest } from "@/core/kernel/request-run";
import { buildMessageOptions } from "@/core/runtime/message-options";
import { splitResultMessage } from "@/core/runtime/result-message";
import { createRateLimitedImAdapter } from "@/core/runtime/message-updates";
import type { OpenCodeOptions } from "@/agents";
import {
  BotRuntime,
  RuntimeKernel,
  ThreadRuntimeRegistry,
} from "@/core/kernel/runtime-kernel";
import type { InboundAdapter } from "@/ims/shared/inbound-adapter";
import type { RawInboundEvent } from "@/core/model/raw-inbound-event";
import type { RuntimeRequestContext } from "@/core/runtime/request-context";

type RuntimeDeps = {
  platform: "slack" | "discord" | "lark";
  im: IMAdapter;
  agent: AgentAdapter;
};

type RuntimeState = {
  liveEventHistory: Map<string, SessionEvent[]>;
  liveParsedState: Map<string, SessionMessageState>;
};

function createRuntimeState(): RuntimeState {
  return {
    liveEventHistory: new Map(),
    liveParsedState: new Map(),
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

  const threadRuntimeRegistry = new ThreadRuntimeRegistry({
    ttlMs: 30 * 60 * 1000,
    sweepIntervalMs: 5 * 60 * 1000,
    onDecision: async (_threadKey, params) => {
      const { event, decision } = params;
      if (decision.kind === "ignore" || decision.kind === "command") return;
      if (decision.kind === "stop") {
        await handleStopCommand(event.channelId, event.threadId);
        return;
      }

      await handleUserMessageInternal(
        {
          channelId: event.channelId,
          rawChannelId: event.rawChannelId,
          replyThreadId: event.replyThreadId,
          threadId: event.threadId,
          userId: event.userId,
          messageId: event.messageId,
          botToken: event.botId,
        },
        decision.text
      );
    },
  });
  const inboundAdapter: InboundAdapter = {
    evaluate: (event) => {
      const text = event.normalizedText.trim();
      if (!text) {
        return { kind: "ignore", reason: "empty_text" };
      }
      return { kind: "message", text };
    },
  };
  const runtimeKernel = new RuntimeKernel({
    createBotRuntime: (botKey) => new BotRuntime(botKey, {
      inboundAdapter,
      commandService: { handle: async () => {} },
      threadRuntimeRegistry,
    }),
  });

  async function publishFinalText(params: {
    channelId: string;
    threadId: string;
    statusTs: string;
    text: string;
  }): Promise<void> {
    const { channelId, threadId, statusTs, text } = params;
    const statusFormat = getUserGeneralSettings().defaultStatusMessageFormat;
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

  async function handleUserMessageInternal(context: RuntimeRequestContext, text: string): Promise<void> {
    const { channelId, replyThreadId, threadId } = context;
    const rawChannelId = context.rawChannelId ?? channelId;
    const prepared = await prepareRuntimeSession({
      deps: runtimeDeps,
      context,
    });
    if (!prepared) return;

    const { session, sessionId, created, cwd, threadOwnerUserId } = prepared;

    await maybeSyncBranchAndThread({
      session,
      cwd,
    });

    const threadHistory = created
      ? await runtimeDeps.im.fetchThreadHistory(rawChannelId, replyThreadId, context.messageId)
      : null;

    const agentContext = await runtimeDeps.im.buildAgentContext({
      cwd,
      channelId: rawChannelId,
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
      agentContext,
      options,
      liveEventHistory: state.liveEventHistory,
      liveParsedState: state.liveParsedState,
      publishFinalText,
    });

    if (!responses) return;
  }

  async function dispatchCoreMessage(context: RuntimeRequestContext, text: string): Promise<void> {
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
    await runtimeKernel.handleInbound({
      platform: deps.platform,
      botId: context.botToken ?? "default",
      channelId: context.channelId,
      rawChannelId: context.rawChannelId,
      threadId: context.threadId,
      replyThreadId: context.replyThreadId,
      messageId: context.messageId,
      userId: context.userId,
      isTopLevel: false,
      mentionedBot: true,
      activeThread: true,
      rawText: text,
      normalizedText: text,
      receivedAtMs: Date.now(),
    });
  }

  async function handleInboundEvent(event: RawInboundEvent): Promise<void> {
    const shouldProcess = event.isTopLevel
      ? event.mentionedBot
      : (event.mentionedBot || event.activeThread);
    if (!shouldProcess) return;

    const text = event.normalizedText.trim();
    if (!text) return;

    if (text.toLowerCase() === "stop") {
      const stopped = await handleStopCommand(event.channelId, event.threadId);
      if (stopped) {
        await runtimeDeps.im.sendMessage(event.rawChannelId ?? event.channelId, event.replyThreadId, "Request stopped.");
      }
      return;
    }

    markThreadActive(event.channelId, event.threadId);
    await dispatchCoreMessage(
      {
        channelId: event.channelId,
        rawChannelId: event.rawChannelId,
        replyThreadId: event.replyThreadId,
        threadId: event.threadId,
        userId: event.userId,
        messageId: event.messageId,
        botToken: event.botId,
      },
      text
    );
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
    rawChannelId?: string;
    replyThreadId: string;
    threadId: string;
    userId: string;
    selection: string;
    messageTs: string;
  }): Promise<void> {
    const { channelId, rawChannelId, replyThreadId, threadId, userId, selection, messageTs } = params;
    await handleInboundEvent({
      platform: deps.platform,
      botId: "default",
      channelId,
      rawChannelId,
      threadId,
      replyThreadId,
      messageId: messageTs,
      userId,
      isTopLevel: false,
      mentionedBot: true,
      activeThread: true,
      rawText: selection,
      normalizedText: selection,
      receivedAtMs: Date.now(),
    });
  }

  async function recoverPendingRequests(): Promise<void> {
    await recoverPendingRequestsInternal(runtimeDeps.im, deps.platform);
  }

  return {
    handleInboundEvent,
    handleButtonSelection,
    recoverPendingRequests,
  };
}
