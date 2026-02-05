import {
  getDefaultOpenCodeServerUrl,
  isLocalMode,
  resolveMessageFrequency,
  resolveChannelCwd,
  resolveGitStrategy,
} from "@/config";
import {
  loadSession,
  saveSession,
  createActiveRequest,
  updateActiveRequest,
  completeActiveRequest,
  failActiveRequest,
  clearActiveRequest,
  getSessionsWithPendingRequests,
  isMessageProcessed,
  markMessageProcessed,
  getPendingQuestion,
  setPendingQuestion,
  clearPendingQuestion,
  type ActiveRequest,
  type PendingQuestion,
  type PersistedSession,
  type TrackedTool,
  type TrackedTodo,
} from "@/config/local/sessions";
import { storeSessionEvent, storeSessionMeta } from "@/config/local/redis";
import {
  buildLiveStatusMessage,
  buildSessionMessageState,
  getStatusMessageKey,
  type SessionEvent,
  type SessionMessageState,
  log,
} from "@/utils";
import { buildSessionEnvironment, prepareSessionWorkspace } from "@/core/session";
import { CoreStateMachine } from "@/core/state-machine";
import type { AgentAdapter, CoreMessageContext, IMAdapter, NormalizedQuestion } from "@/core/types";

type RuntimeDeps = {
  im: IMAdapter;
  agent: AgentAdapter;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function isRedisTrackingEnabled(): boolean {
  if (!isLocalMode()) return false;
  const flag = process.env.ODE_REDIS_ENABLED?.trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

function buildFinalResponseText(responses: Array<{ text?: string }>): string | null {
  const texts = responses
    .map((response) => response.text?.trim())
    .filter((text): text is string => Boolean(text));
  if (texts.length === 0) return null;
  return texts.join("\n\n");
}

function categorizeError(
  err: unknown,
  serverUrlOverride?: string
): { message: string; suggestion: string } {
  const errorStr = err instanceof Error ? err.message : String(err);

  if (errorStr.includes("timeout") || errorStr.includes("ETIMEDOUT")) {
    return {
      message: "Request timed out",
      suggestion: "The operation took too long. Try a simpler request or break it into smaller steps.",
    };
  }

  if (errorStr.includes("rate limit") || errorStr.includes("429")) {
    return {
      message: "Rate limited",
      suggestion: "Too many requests. Please wait a moment and try again.",
    };
  }

  if (errorStr.includes("authentication") || errorStr.includes("401") || errorStr.includes("403")) {
    return {
      message: "Authentication error",
      suggestion: "There may be an issue with API credentials. Contact your administrator.",
    };
  }

  if (
    errorStr.includes("ConnectionRefused") ||
    errorStr.includes("ECONNREFUSED") ||
    errorStr.includes("ENOTFOUND") ||
    errorStr.includes("network")
  ) {
    let defaultUrl: string | undefined;
    try {
      defaultUrl = getDefaultOpenCodeServerUrl();
    } catch {
      defaultUrl = undefined;
    }
    const serverUrl = serverUrlOverride || defaultUrl;
    const message = serverUrl
      ? `OpenCode server not accessible on ${serverUrl}`
      : "OpenCode server not accessible";
    return {
      message,
      suggestion: "Check that the OpenCode server is running and reachable.",
    };
  }

  if (errorStr.includes("empty response")) {
    return {
      message: "No response received",
      suggestion: "The model didn't generate a response. Try rephrasing your request.",
    };
  }

  return {
    message: errorStr.length > 100 ? `${errorStr.slice(0, 100)}...` : errorStr,
    suggestion: "If this persists, try starting a new thread or contact support.",
  };
}

function formatQuestionPrompt(questions: NormalizedQuestion[]): string {
  const lines = questions.map((question, index) => {
    const prefix = questions.length > 1 ? `${index + 1}. ` : "";
    const optionText = question.options?.length
      ? `\nOptions: ${question.options.join(" / ")}`
      : "";
    return `${prefix}${question.question}${optionText}`;
  });

  return lines.join("\n\n");
}

function buildQuestionAnswers(
  questions: NormalizedQuestion[],
  responseText: string
): Array<Array<string>> {
  const trimmed = responseText.trim();
  if (questions.length <= 1) {
    return [[trimmed]];
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return questions.map((_, index) => {
    const line = lines[index] ?? "";
    return [line];
  });
}

type RuntimeState = {
  liveEventHistory: Map<string, SessionEvent[]>;
  liveParsedState: Map<string, SessionMessageState>;
  threadQueues: Map<string, { processing: boolean; items: Array<{ context: CoreMessageContext; text: string }> }>;
  stateMachines: Map<string, CoreStateMachine>;
};

function createRuntimeState(): RuntimeState {
  return {
    liveEventHistory: new Map(),
    liveParsedState: new Map(),
    threadQueues: new Map(),
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

  async function handlePendingQuestionReply(
    pendingQuestion: PendingQuestion,
    context: CoreMessageContext,
    text: string
  ): Promise<boolean> {
    if (isMessageProcessed(context.messageId)) {
      log.debug("Skipping duplicate question reply", { messageId: context.messageId });
      return true;
    }

    const session = loadSession(context.channelId, context.threadId);
    const threadOwnerUserId = session?.threadOwnerUserId;
    if (threadOwnerUserId && threadOwnerUserId !== context.userId) {
      return false;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      await deps.im.sendMessage(context.channelId, context.threadId, "Please reply with an answer.", false);
      return true;
    }

    markMessageProcessed(context.messageId);

    try {
      const answers = buildQuestionAnswers(pendingQuestion.questions, trimmed);
      await deps.agent.replyToQuestion({
        requestId: pendingQuestion.requestId,
        sessionId: pendingQuestion.sessionId,
        directory: session?.workingDirectory,
        answers,
      });
      clearPendingQuestion(context.channelId, context.threadId);
      return true;
    } catch (err) {
      log.error("Failed to answer OpenCode question", { error: String(err) });
      await deps.im.sendMessage(
        context.channelId,
        context.threadId,
        "Failed to submit your answer. Please try again.",
        false
      );
      return true;
    }
  }

  async function startEventStreamWatcher(
    request: ActiveRequest,
    workingPath: string,
    stateMachine: CoreStateMachine,
    onUpdate: () => void,
    onStop?: () => void
  ): Promise<() => void> {
    if (!deps.agent.supportsEventStream) {
      return () => {};
    }

    const shouldStoreEvents = isRedisTrackingEnabled();

    await deps.agent.ensureSession(request.sessionId);

    const messageKey = getStatusMessageKey(request);
    const eventHistory = state.liveEventHistory.get(messageKey) ?? [];
    if (!state.liveEventHistory.has(messageKey)) {
      state.liveEventHistory.set(messageKey, eventHistory);
    }

    function applyStateFromEvents(): void {
      const parsedState = buildSessionMessageState(eventHistory, {
        workingDirectory: workingPath,
        baseState: { startedAt: request.startedAt },
      });
      state.liveParsedState.set(messageKey, parsedState);
      request.currentText = parsedState.currentText;
      request.tools = parsedState.tools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        status: tool.status as TrackedTool["status"],
        title: tool.title,
        output: tool.output,
        error: tool.error,
      }));
      request.todos = parsedState.todos.map((todo) => ({
        content: todo.content,
        status: todo.status as TrackedTodo["status"],
      }));
    }

    let stopNotified = false;

    const unsubscribe = deps.agent.subscribeToSession(request.sessionId, (globalEvent: unknown) => {
      const event = (globalEvent as any).payload ?? globalEvent;
      log.info("[OPENCODE] Event", {
        sessionId: request.sessionId,
        type: (event as any)?.type ?? "unknown",
        properties: (event as any)?.properties,
        directory: (globalEvent as any)?.directory,
      });

      if (!stopNotified && event?.type === "message.part.updated") {
        const part = (event as any)?.properties?.part;
        if (part?.type === "step-finish" && part?.reason === "stop") {
          stopNotified = true;
          onStop?.();
        }
      }

      const sessionEvent: SessionEvent = {
        timestamp: Date.now(),
        type: event.type || "unknown",
        data: event as Record<string, unknown>,
      };
      eventHistory.push(sessionEvent);

      if (shouldStoreEvents) {
        void storeSessionEvent({
          timestamp: Date.now(),
          type: event.type || "unknown",
          sessionId: request.sessionId,
          channelId: request.channelId,
          threadId: request.threadId,
          data: event as Record<string, unknown>,
        });
      }
      const pendingQuestion = getPendingQuestion(request.channelId, request.threadId);

      if (pendingQuestion) {
        if (event.type === "question.replied" || event.type === "question.rejected") {
          const requestId = event.properties?.requestID;
          if (!requestId || requestId !== pendingQuestion.requestId) {
            return;
          }
          clearPendingQuestion(request.channelId, request.threadId);
          stateMachine.transition("resume_processing");
          onUpdate();
          return;
        }
        if (event.type !== "question.asked") {
          return;
        }
      }

      applyStateFromEvents();

      if (event.type === "question.asked") {
        const properties = event.properties as {
          id?: string;
          sessionID?: string;
          questions?: unknown;
        };
        const requestId = properties?.id;
        if (!requestId) return;

        const existingQuestion = getPendingQuestion(request.channelId, request.threadId);
        if (existingQuestion?.requestId === requestId) return;

          const normalized = deps.agent.normalizeQuestions(properties.questions);
        if (normalized.length === 0) return;

        request.statusFrozen = true;
        stateMachine.transition("wait_for_user");
        const prompt = formatQuestionPrompt(normalized);
        request.currentText = prompt;
        onUpdate();

        void (async () => {
          await deps.im.updateMessage(
            request.channelId,
            request.statusMessageTs,
            buildLiveStatusMessage(request, workingPath, state.liveParsedState.get(messageKey)),
            false
          );
          setPendingQuestion(request.channelId, request.threadId, {
            requestId,
            sessionId: properties.sessionID ?? request.sessionId,
            askedAt: Date.now(),
            questions: normalized,
            messageTs: request.statusMessageTs,
          });
        })();
        return;
      }

      onUpdate();
    });

    return unsubscribe;
  }

  async function runOpenCodeRequest(
    session: PersistedSession,
    context: CoreMessageContext,
    sessionId: string,
    cwd: string,
    message: string,
    phaseLabel: string,
    agentContext: Awaited<ReturnType<IMAdapter["buildAgentContext"]>>,
    stateMachine: CoreStateMachine,
    options?: { agent?: string },
    serverUrlOverride?: string
  ) {
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

    if (isRedisTrackingEnabled()) {
      void storeSessionMeta({
        sessionId: session.sessionId,
        channelId: session.channelId,
        threadId: session.threadId,
        workingDirectory: session.workingDirectory,
        createdAt: session.createdAt,
        lastActivityAt: Date.now(),
        threadOwnerUserId: session.threadOwnerUserId,
      });
    }

    let lastHeartbeat = Date.now();
    const progressTimer = setInterval(async () => {
      if (request.state !== "processing") return;

      const now = Date.now();
      if (now - lastHeartbeat > 5000) {
        lastHeartbeat = now;
        request.lastUpdatedAt = now;
      }

      const statusText = buildLiveStatusMessage(
        request,
        cwd,
        state.liveParsedState.get(getStatusMessageKey(request))
      );
      if (!request.statusFrozen) {
        await deps.im.updateMessage(context.channelId, statusTs, statusText, false);
      }
      updateActiveRequest(context.channelId, context.threadId, {
        currentText: request.currentText,
        tools: request.tools,
        todos: request.todos,
        statusFrozen: request.statusFrozen,
      });
    }, 2000);

    const stopSignal = createDeferred<void>();
    const stopWatcher = await startEventStreamWatcher(request, cwd, stateMachine, () => {}, () => {
      stopSignal.resolve();
    });

    try {
      stateMachine.transition("start_processing");
      const promptPromise = deps.agent.sendMessage(
        context.channelId,
        sessionId,
        message,
        cwd,
        options,
        agentContext
      );
      const result = await Promise.race([
        promptPromise.then((responses) => ({ type: "prompt" as const, responses })),
        stopSignal.promise.then(() => ({ type: "stop" as const })),
      ]);

      clearInterval(progressTimer);
      stopWatcher();
      request.state = "completed";

      state.liveEventHistory.delete(getStatusMessageKey(request));
      state.liveParsedState.delete(getStatusMessageKey(request));
      completeActiveRequest(context.channelId, context.threadId);

      if (result.type === "stop") {
        stateMachine.transition("stop");
        const fallbackText = request.currentText?.trim();
        const finalText = fallbackText || "_Done_";
        if (resolveMessageFrequency() === "aggressive") {
          await deps.im.sendMessage(context.channelId, context.threadId, finalText, true);
        } else {
          await deps.im.updateMessage(context.channelId, statusTs, finalText, true);
        }
        void promptPromise.catch((err) => {
          log.debug("OpenCode prompt rejected after stop", { error: String(err) });
        });
        return fallbackText
          ? [{ text: fallbackText, messageType: "assistant" }]
          : [];
      }

      if (result.responses.length === 0) {
        log.warn("No text responses from model - tool-only response");
      }

      stateMachine.transition("complete");
      const finalText = buildFinalResponseText(result.responses) ?? "_Done_";
      if (resolveMessageFrequency() === "aggressive") {
        await deps.im.sendMessage(context.channelId, context.threadId, finalText, true);
      } else {
        await deps.im.updateMessage(context.channelId, statusTs, finalText, true);
      }

      return result.responses;
    } catch (err) {
      clearInterval(progressTimer);
      stopWatcher();

      stateMachine.transition("fail");
      const { message: errorMessage, suggestion } = categorizeError(err, serverUrlOverride);
      log.error("Request failed", { channelId: context.channelId, threadId: context.threadId, error: String(err) });

      request.state = "failed";
      request.error = errorMessage;

      state.liveEventHistory.delete(getStatusMessageKey(request));
      state.liveParsedState.delete(getStatusMessageKey(request));

      const errorStatus = `Error: ${errorMessage}\n_${suggestion}_`;
      await deps.im.updateMessage(context.channelId, statusTs, errorStatus, false);
      failActiveRequest(context.channelId, context.threadId, errorMessage);
      return null;
    }
  }

  function getThreadQueueKey(channelId: string, threadId: string): string {
    return `${channelId}-${threadId}`;
  }

  async function processThreadQueue(queueKey: string): Promise<void> {
    const queue = state.threadQueues.get(queueKey);
    if (!queue || queue.processing) return;

    queue.processing = true;
    while (queue.items.length > 0) {
      const batch = queue.items.splice(0);
      const next = batch[0];
      if (!next) continue;
      const combinedText = batch.map((item) => item.text).join("\n");
      try {
        await handleUserMessageInternal(next.context, combinedText);
      } catch (err) {
        log.error("Queued message processing failed", { error: String(err) });
      }
    }
    queue.processing = false;

    if (queue.items.length === 0) {
      state.threadQueues.delete(queueKey);
      return;
    }

    void processThreadQueue(queueKey);
  }

  function enqueueUserMessage(context: CoreMessageContext, text: string): void {
    const queueKey = getThreadQueueKey(context.channelId, context.threadId);
    const queue = state.threadQueues.get(queueKey) ?? { processing: false, items: [] };
    queue.items.push({ context, text });
    state.threadQueues.set(queueKey, queue);

    if (!queue.processing) {
      void processThreadQueue(queueKey);
    }
  }

  async function handleUserMessageInternal(context: CoreMessageContext, text: string): Promise<void> {
    const { channelId, threadId } = context;
    const stateMachine = getStateMachine(context);
    let cwd: string;
    try {
      cwd = resolveChannelCwd(channelId).cwd;
    } catch (err) {
      await deps.im.sendMessage(channelId, threadId, `Error: ${String(err)}`, false);
      return;
    }

    let session = loadSession(channelId, threadId);
    const threadOwnerUserId = session?.threadOwnerUserId ?? context.userId;
    const { env: sessionEnv, gitIdentity } = buildSessionEnvironment({
      threadOwnerUserId,
      opencodeServerUrl: context.opencodeServerUrl,
    });

    let sessionId: string;
    let created: boolean;

    try {
      stateMachine.transition("prepare_session");
      ({ sessionId, created } = await deps.agent.getOrCreateSession(channelId, threadId, cwd, sessionEnv));
    } catch (err) {
      const { message, suggestion } = categorizeError(err, context.opencodeServerUrl);
      log.error("Failed to create OpenCode session", {
        channelId,
        threadId,
        error: String(err),
        opencodeServerUrl: context.opencodeServerUrl,
      });
      await deps.im.sendMessage(channelId, threadId, `Error: ${message}\n_${suggestion}_`, false);
      return;
    }

    if (resolveGitStrategy() === "worktree") {
      try {
        stateMachine.transition("prepare_worktree");
        const worktreeId = `ode_${threadId}`;
        const { cwd: resolvedCwd, worktree } = await prepareSessionWorkspace({
          channelId,
          threadId,
          cwd,
          worktreeId,
          sessionEnv,
          gitIdentity,
        });
        if (worktree.skipped && worktree.message) {
          await deps.im.sendMessage(channelId, threadId, worktree.message, false);
        }
        cwd = resolvedCwd;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("Failed to prepare worktree", {
          channelId,
          threadId,
          sessionId,
          error: message,
        });
        await deps.im.sendMessage(
          channelId,
          threadId,
          `Error: Failed to prepare worktree. ${message}`,
          false,
        );
        return;
      }
    }

    if (!session) {
      session = {
        sessionId,
        channelId,
        threadId,
        workingDirectory: cwd,
        threadOwnerUserId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };
    } else if (session.sessionId !== sessionId) {
      session.sessionId = sessionId;
    }

    if (session.workingDirectory !== cwd) {
      session.workingDirectory = cwd;
    }

    if (!session.threadOwnerUserId) {
      session.threadOwnerUserId = threadOwnerUserId;
    }
    saveSession(session);

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

    const responses = await runOpenCodeRequest(
      session,
      context,
      sessionId,
      cwd,
      text,
      "Working",
      agentContext,
      stateMachine,
      agent ? { agent } : undefined,
      context.opencodeServerUrl
    );

    if (!responses) return;
  }

  async function handleIncomingMessage(context: CoreMessageContext, text: string): Promise<void> {
    if (isMessageProcessed(context.messageId)) {
      log.debug("Skipping duplicate message", { messageId: context.messageId });
      return;
    }

    const pendingQuestion = getPendingQuestion(context.channelId, context.threadId);
    if (pendingQuestion) {
      const handled = await handlePendingQuestionReply(pendingQuestion, context, text);
      if (handled) {
        return;
      }
    }

    markMessageProcessed(context.messageId);
    enqueueUserMessage(context, text);
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
    let cwd: string;
    try {
      cwd = resolveChannelCwd(channelId).cwd;
    } catch (err) {
      await deps.im.sendMessage(channelId, threadId, `Error: ${String(err)}`, false);
      return;
    }

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

    const progressTimer = setInterval(async () => {
      if (request.state !== "processing") return;
      const statusText = buildLiveStatusMessage(
        request,
        cwd,
        state.liveParsedState.get(getStatusMessageKey(request))
      );
      await deps.im.updateMessage(channelId, statusTs, statusText, false);
    }, 2000);

    const stopSignal = createDeferred<void>();
    const stopWatcher = await startEventStreamWatcher(request, cwd, getStateMachine({ channelId, threadId }), () => {}, () => {
      stopSignal.resolve();
    });

    try {
      const agentContext = await deps.im.buildAgentContext({
        cwd,
        channelId,
        threadId,
        userId: threadOwnerUserId,
      });

      getStateMachine({ channelId, threadId }).transition("start_processing");
      const promptPromise = deps.agent.sendMessage(
        channelId,
        sessionId,
        `User selected: ${selection}`,
        cwd,
        agent ? { agent } : undefined,
        agentContext
      );
      const result = await Promise.race([
        promptPromise.then((responses) => ({ type: "prompt" as const, responses })),
        stopSignal.promise.then(() => ({ type: "stop" as const })),
      ]);

      clearInterval(progressTimer);
      stopWatcher();
      request.state = "completed";

      state.liveEventHistory.delete(getStatusMessageKey(request));
      state.liveParsedState.delete(getStatusMessageKey(request));

      if (result.type === "stop") {
        getStateMachine({ channelId, threadId }).transition("stop");
        const fallbackText = request.currentText?.trim();
        const finalText = fallbackText || "_Done_";
        if (resolveMessageFrequency() === "aggressive") {
          await deps.im.sendMessage(channelId, threadId, finalText, true);
        } else {
          await deps.im.updateMessage(channelId, statusTs, finalText, true);
        }
        completeActiveRequest(channelId, threadId);
        void promptPromise.catch((err) => {
          log.debug("OpenCode prompt rejected after stop", { error: String(err) });
        });
        return;
      }

      getStateMachine({ channelId, threadId }).transition("complete");
      const finalText = buildFinalResponseText(result.responses) ?? "_Done_";
      if (resolveMessageFrequency() === "aggressive") {
        await deps.im.sendMessage(channelId, threadId, finalText, true);
      } else {
        await deps.im.updateMessage(channelId, statusTs, finalText, true);
      }

      completeActiveRequest(channelId, threadId);
    } catch (err) {
      clearInterval(progressTimer);
      stopWatcher();

      getStateMachine({ channelId, threadId }).transition("fail");
      const { message, suggestion } = categorizeError(err);
      log.error("Button selection handling failed", { error: String(err) });

      request.state = "failed";
      request.error = message;

      state.liveEventHistory.delete(getStatusMessageKey(request));
      state.liveParsedState.delete(getStatusMessageKey(request));

      const errorStatus = `Error: ${message}\n_${suggestion}_`;
      await deps.im.updateMessage(channelId, statusTs, errorStatus, false);
      failActiveRequest(channelId, threadId, message);
    }
  }

  async function recoverPendingRequests(): Promise<void> {
    const pendingSessions = getSessionsWithPendingRequests();

    if (pendingSessions.length === 0) {
      log.info("No pending requests to recover");
    } else {
      log.info("Found pending requests to recover", { count: pendingSessions.length });

      for (const session of pendingSessions) {
        const request = session.activeRequest;
        if (!request) continue;

        const age = Date.now() - request.startedAt;
        if (age > 10 * 60 * 1000) {
          log.info("Clearing stale request", {
            channelId: session.channelId,
            threadId: session.threadId,
            age: Math.floor(age / 1000) + "s",
          });
          clearActiveRequest(session.channelId, session.threadId);
          continue;
        }

        await deps.im.updateMessage(
          request.channelId,
          request.statusMessageTs,
          "_Bot restarted - please resend your message_",
          false
        );

        clearActiveRequest(session.channelId, session.threadId);
      }
    }
  }

  return {
    handleIncomingMessage,
    handleStopCommand,
    handleButtonSelection,
    recoverPendingRequests,
  };
}
