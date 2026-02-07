import type { OpenCodeMessage } from "@/agents";
import type { ActiveRequest } from "@/config/local/sessions";
import { CoreStateMachine } from "@/core/state-machine";
import { buildFinalResponseText, categorizeRuntimeError, createDeferred } from "@/core/runtime/helpers";
import { startEventStreamWatcher } from "@/core/runtime/event-stream";
import type { AgentAdapter, IMAdapter } from "@/core/types";
import { getStatusMessageKey, type SessionEvent, type SessionMessageState, log } from "@/utils";

type RunnerDeps = {
  im: IMAdapter;
  agent: AgentAdapter;
};

export type RunTrackedRequestParams = {
  deps: RunnerDeps;
  request: ActiveRequest;
  statusTs: string;
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

export async function runTrackedRequest(
  params: RunTrackedRequestParams
): Promise<RunTrackedRequestResult> {
  const {
    deps,
    request,
    statusTs,
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

  const progressTimer = setInterval(async () => {
    if (request.state !== "processing") return;
    await onProgressTick();
  }, 2000);

  const stopSignal = createDeferred<void>();
  const stopWatcher = await startEventStreamWatcher({
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

  try {
    stateMachine.transition("start_processing");
    const promptPromise = sendPrompt();
    const result = await Promise.race([
      promptPromise.then((responses) => ({ type: "prompt" as const, responses })),
      stopSignal.promise.then(() => ({ type: "stop" as const })),
    ]);

    clearInterval(progressTimer);
    stopWatcher();
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
      log.warn("No text responses from model - tool-only response");
    }

    stateMachine.transition("complete");
    const finalText = buildFinalResponseText(result.responses) ?? "_Done_";
    await publishFinalText(finalText);
    onComplete();
    return { responses: result.responses };
  } catch (err) {
    clearInterval(progressTimer);
    stopWatcher();

    stateMachine.transition("fail");
    const { message, suggestion } = categorizeRuntimeError(err);
    log.error(failureLogLabel, { channelId: request.channelId, threadId: request.threadId, error: String(err) });

    request.state = "failed";
    request.error = message;

    liveEventHistory.delete(getStatusMessageKey(request));
    liveParsedState.delete(getStatusMessageKey(request));

    const errorStatus = `Error: ${message}\n_${suggestion}_`;
    await deps.im.updateMessage(request.channelId, statusTs, errorStatus, false);
    onFail(message);
    return { responses: null };
  }
}
