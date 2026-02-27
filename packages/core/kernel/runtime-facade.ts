import {
  loadSession,
  failActiveRequest,
  isMessageProcessed,
  markMessageProcessed,
  markThreadActive,
  getPendingQuestion,
} from "@/config/local/sessions";
import { type SessionEvent, type SessionMessageState, log } from "@/utils";
import type { AgentAdapter, IMAdapter } from "@/core/types";
import { handlePendingQuestionReply } from "@/core/kernel/pending-question";
import { recoverPendingRequests as recoverPendingRequestsInternal } from "@/core/runtime/recovery";
import { prepareRuntimeSession } from "@/core/kernel/session-bootstrap";
import { runOpenRequest } from "@/core/kernel/request-run";
import { maybeSyncBranchAndThread, publishFinalText } from "@/core/kernel/runtime-support";
import { buildMessageOptions } from "@/core/runtime/message-options";
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

export type RuntimeDeps = {
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

export class KernelRuntimeFacade {
  private readonly runtimeDeps: RuntimeDeps;
  private readonly state = createRuntimeState();
  private readonly runtimeKernel: RuntimeKernel;

  constructor(private readonly deps: RuntimeDeps) {
    this.runtimeDeps = {
      ...deps,
      im: createRateLimitedImAdapter(deps.im),
    };

    const threadRuntimeRegistry = new ThreadRuntimeRegistry({
      ttlMs: 30 * 60 * 1000,
      sweepIntervalMs: 5 * 60 * 1000,
      onDecision: async (_threadKey, params) => {
        const { event, decision } = params;
        if (decision.kind === "ignore" || decision.kind === "command") return;
        if (decision.kind === "stop") {
          await this.handleStopCommand(event.channelId, event.threadId);
          return;
        }

        await this.handleUserMessageInternal(
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

    this.runtimeKernel = new RuntimeKernel({
      createBotRuntime: (botKey) => new BotRuntime(botKey, {
        inboundAdapter,
        commandService: { handle: async () => {} },
        threadRuntimeRegistry,
      }),
    });
  }

  async handleInboundEvent(event: RawInboundEvent): Promise<void> {
    const shouldProcess = event.isTopLevel
      ? event.mentionedBot
      : (event.mentionedBot || event.activeThread);
    if (!shouldProcess) return;

    const text = event.normalizedText.trim();
    if (!text) return;

    if (text.toLowerCase() === "stop") {
      const stopped = await this.handleStopCommand(event.channelId, event.threadId);
      if (stopped) {
        await this.runtimeDeps.im.sendMessage(event.rawChannelId ?? event.channelId, event.replyThreadId, "Request stopped.");
      }
      return;
    }

    markThreadActive(event.channelId, event.threadId);
    await this.dispatchCoreMessage(
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

  async handleButtonSelection(params: {
    channelId: string;
    rawChannelId?: string;
    replyThreadId: string;
    threadId: string;
    userId: string;
    selection: string;
    messageTs: string;
  }): Promise<void> {
    const { channelId, rawChannelId, replyThreadId, threadId, userId, selection, messageTs } = params;
    await this.handleInboundEvent({
      platform: this.deps.platform,
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

  async recoverPendingRequests(): Promise<void> {
    await recoverPendingRequestsInternal(this.runtimeDeps.im, this.deps.platform);
  }

  private async handleUserMessageInternal(context: RuntimeRequestContext, text: string): Promise<void> {
    const { channelId, replyThreadId, threadId } = context;
    const rawChannelId = context.rawChannelId ?? channelId;
    const prepared = await prepareRuntimeSession({
      deps: this.runtimeDeps,
      context,
    });
    if (!prepared) return;

    const { session, sessionId, created, cwd, threadOwnerUserId } = prepared;

    await maybeSyncBranchAndThread({ session, cwd });

    const threadHistory = created
      ? await this.runtimeDeps.im.fetchThreadHistory(rawChannelId, replyThreadId, context.messageId)
      : null;

    const agentContext = await this.runtimeDeps.im.buildAgentContext({
      cwd,
      channelId: rawChannelId,
      replyThreadId,
      threadId,
      userId: threadOwnerUserId,
      threadHistory,
    });

    const providerId = this.deps.agent.getProviderForSession(sessionId);
    const options: OpenCodeOptions | undefined = buildMessageOptions({
      text,
      channelId,
      providerId,
    });

    const responses = await runOpenRequest({
      deps: {
        ...this.runtimeDeps,
        platform: this.deps.platform,
      },
      session,
      context,
      sessionId,
      cwd,
      message: text,
      isFirstMessageInThread: created,
      agentContext,
      options,
      liveEventHistory: this.state.liveEventHistory,
      liveParsedState: this.state.liveParsedState,
      publishFinalText: async (params) => {
        await publishFinalText({
          im: this.runtimeDeps.im,
          ...params,
        });
      },
    });

    if (!responses) return;
  }

  private async dispatchCoreMessage(context: RuntimeRequestContext, text: string): Promise<void> {
    if (isMessageProcessed(context.channelId, context.threadId, context.messageId)) {
      log.debug("Skipping duplicate message", { messageId: context.messageId });
      return;
    }

    const pendingQuestion = getPendingQuestion(context.channelId, context.threadId);
    if (pendingQuestion) {
      const handled = await handlePendingQuestionReply({
        deps: this.runtimeDeps,
        pendingQuestion,
        context,
        text,
      });
      if (handled) {
        return;
      }
    }

    markMessageProcessed(context.channelId, context.threadId, context.messageId);
    await this.runtimeKernel.handleInbound({
      platform: this.deps.platform,
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

  private async handleStopCommand(channelId: string, threadId: string): Promise<boolean> {
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
      await this.deps.agent.abortSession(session.sessionId, cwd);
    } catch {
      // Ignore abort errors
    }

    if (!request || request.state !== "processing") {
      return true;
    }

    request.state = "failed";
    request.error = "Stopped by user";

    await this.runtimeDeps.im.deleteMessage(request.channelId, request.statusMessageTs);

    failActiveRequest(channelId, threadId, "Stopped by user");
    return true;
  }
}
