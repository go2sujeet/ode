import { buildStatusMessageByProvider, type StatusRequest } from "@/utils/status";
import { buildSessionMessageState, type SessionEvent } from "@/utils/session-inspector";
import type {
  HarnessCapturedEvent,
  HarnessRenderedStatus,
  HarnessRunMeta,
} from "./types";

function toSessionEvent(event: HarnessCapturedEvent): SessionEvent {
  const raw = event.event as Record<string, unknown>;
  const payload = raw?.payload;
  const eventRecord = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : raw;
  return {
    timestamp: event.timestamp,
    type: typeof eventRecord.type === "string" ? eventRecord.type : "unknown",
    data: raw,
  };
}

export function renderStatusesFromRun(meta: HarnessRunMeta, events: HarnessCapturedEvent[]): HarnessRenderedStatus[] {
  const sessionEvents = events
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(toSessionEvent);
  const statuses: HarnessRenderedStatus[] = [];

  const request: StatusRequest = {
    channelId: meta.channelId,
    threadId: meta.threadId,
    statusMessageTs: "harness-status",
    startedAt: meta.startedAt,
    currentText: "",
  };

  let previousText = "";
  for (let index = 0; index < sessionEvents.length; index += 1) {
    const state = buildSessionMessageState(sessionEvents, {
      endIndex: index,
      workingDirectory: meta.cwd,
      provider: meta.provider,
      baseState: { startedAt: meta.startedAt },
    });
    const text = buildStatusMessageByProvider(meta.provider, request, meta.cwd, state, "medium");
    if (text === previousText) continue;
    previousText = text;
    statuses.push({
      index,
      timestamp: sessionEvents[index]?.timestamp ?? meta.startedAt,
      text,
    });
  }

  return statuses;
}
