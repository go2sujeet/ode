import type { OpenCodeMessage } from "@/agents";
import type { ActiveRequest } from "@/config/local/sessions";
import { CoreStateMachine } from "@/core/state-machine";
import { buildFinalResponseText, categorizeRuntimeError, createDeferred } from "@/core/runtime/helpers";
import { startEventStreamWatcher } from "@/core/runtime/event-stream";
import { getMessageUpdateIntervalMs } from "@/config";
import type { AgentAdapter, IMAdapter } from "@/core/types";
import { getStatusMessageKey, type SessionEvent, type SessionMessageState, log } from "@/utils";

type RunnerDeps = {
  im: IMAdapter;
  agent: AgentAdapter;
};

export type RunTrackedRequestParams = {
  deps: RunnerDeps;
  request: ActiveRequest;
  workingPath: string;
  stateMachine: CoreStateMachine;
  liveEventHistory: Map<string, SessionEvent[]>;
  liveParsedState: Map<string, SessionMessageState>;
  sendPrompt: () => Promise<OpenCodeMessage[]>;
  onProgressTick: () => Promise<void>;
  onComplete: () => void;
  onFail: (message: string) => void;
  publishFinalText: (text: string) => Promise<void>;
  failureLogLabel: string;
};

export type RunTrackedRequestResult = {
  responses: OpenCodeMessage[] | null;
  stopFallbackText?: string;
};

function isExternallySettled(request: ActiveRequest): boolean {
  return request.state !== "processing";
}

export async function runTrackedRequest(
  params: RunTrackedRequestParams
): Promise<RunTrackedRequestResult> {
  const {
    deps,
    request,
    workingPath,
    stateMachine,
    liveEventHistory,
    liveParsedState,
    sendPrompt,
    onProgressTick,
    onComplete,
    onFail,
    publishFinalText,
    failureLogLabel,
  } = params;

  const progressIntervalMs = getMessageUpdateIntervalMs();
  let progressInFlight = false;
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let stopWatcher: (() => void) | null = null;

  const runProgressTick = async (): Promise<void> => {
    if (request.state !== "processing") return;
    if (progressInFlight) return;
    progressInFlight = true;
    try {
      await onProgressTick();
    } finally {
      progressInFlight = false;
    }
  };

  const stopSignal = createDeferred<void>();
  try {
    progressTimer = setInterval(() => {
      void runProgressTick();
    }, progressIntervalMs);

    stopWatcher = await startEventStreamWatcher({
      deps,
      request,
      workingPath,
      stateMachine,
      liveEventHistory,
      liveParsedState,
      onUpdate: () => {},
      onStop: () => {
        stopSignal.resolve();
      },
    });

    stateMachine.transition("start_processing");
    const promptPromise = sendPrompt();
    const result = await Promise.race([
      promptPromise.then((responses) => ({ type: "prompt" as const, responses })),
      stopSignal.promise.then(() => ({ type: "stop" as const })),
    ]);

    if (isExternallySettled(request)) {
      stateMachine.transition("stop");
      liveEventHistory.delete(getStatusMessageKey(request));
      liveParsedState.delete(getStatusMessageKey(request));
      return { responses: [] };
    }

    request.state = "completed";

    liveEventHistory.delete(getStatusMessageKey(request));
    liveParsedState.delete(getStatusMessageKey(request));

    if (result.type === "stop") {
      stateMachine.transition("stop");
      const fallbackText = request.currentText?.trim();
      const finalText = fallbackText || "_Done_";
      await publishFinalText(finalText);
      onComplete();

      void promptPromise.catch((err) => {
        log.debug("OpenCode prompt rejected after stop", { error: String(err) });
      });

      return { responses: [], stopFallbackText: fallbackText };
    }

    if (result.responses.length === 0) {
      log.warn("No text responses from model - tool-only response", {
        channelId: request.channelId,
        threadId: request.threadId,
        promptPreview: request.prompt.slice(0, 120),
        currentText: request.currentText,
      });
    }

    stateMachine.transition("complete");
    const finalText = buildFinalResponseText(result.responses) ?? (request.currentText?.trim() || "_Done_");
    await publishFinalText(finalText);
    onComplete();
    return { responses: result.responses };
  } catch (err) {
    if (isExternallySettled(request)) {
      stateMachine.transition("stop");
      liveEventHistory.delete(getStatusMessageKey(request));
      liveParsedState.delete(getStatusMessageKey(request));
      return { responses: [] };
    }

    stateMachine.transition("fail");
    const { message, suggestion } = categorizeRuntimeError(err);
    log.error(failureLogLabel, { channelId: request.channelId, threadId: request.threadId, error: String(err) });

    request.state = "failed";
    request.error = message;

    liveEventHistory.delete(getStatusMessageKey(request));
    liveParsedState.delete(getStatusMessageKey(request));

    const errorStatus = `Error: ${message}\n_${suggestion}_`;
    await deps.im.updateMessage(request.channelId, request.statusMessageTs, errorStatus);
    onFail(message);
    return { responses: null };
  } finally {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    if (stopWatcher) {
      stopWatcher();
      stopWatcher = null;
    }
  }
}
