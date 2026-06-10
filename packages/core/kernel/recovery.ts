import { clearActiveRequest, getSessionsWithPendingRequests, type ActiveRequest } from "@/config/local/sessions";
import type { IMAdapter } from "@/core/types";
import { log } from "@/utils";

async function stopRecoveredStatusStream(im: IMAdapter, request: ActiveRequest): Promise<void> {
  if (!request.statusStreamActive || !request.statusStreamTs || !im.stopStatusStream) return;

  try {
    await im.stopStatusStream(request.channelId, request.statusStreamTs);
  } catch (err) {
    log.warn("Failed to stop recovered status stream", {
      channelId: request.channelId,
      statusTs: request.statusStreamTs,
      error: String(err),
    });
  }
}

export async function recoverPendingRequests(
  im: IMAdapter,
  platform?: "slack" | "discord" | "lark",
  options?: { startedBeforeMs?: number }
): Promise<void> {
  const pendingSessions = await getSessionsWithPendingRequests(platform);

  if (pendingSessions.length === 0) {
    log.debug("No pending requests to recover");
    return;
  }

  log.debug("Found pending requests to recover", { count: pendingSessions.length });

  for (const session of pendingSessions) {
    const request = session.activeRequest;
    if (!request) continue;

    if (typeof options?.startedBeforeMs === "number" && request.startedAt >= options.startedBeforeMs) {
      log.debug("Skipping request created after recovery cutoff", {
        channelId: session.channelId,
        threadId: session.threadId,
        requestStartedAt: request.startedAt,
        recoveryCutoffMs: options.startedBeforeMs,
      });
      continue;
    }

    const age = Date.now() - request.startedAt;
    await stopRecoveredStatusStream(im, request);

    if (age > 10 * 60 * 1000) {
      log.debug("Clearing stale request", {
        channelId: session.channelId,
        threadId: session.threadId,
        age: Math.floor(age / 1000) + "s",
      });
      clearActiveRequest(session.channelId, session.threadId);
      continue;
    }

    await im.updateMessage(
      request.channelId,
      request.statusMessageTs,
      "_Bot restarted - please resend your message_"
    );

    clearActiveRequest(session.channelId, session.threadId);
  }
}
