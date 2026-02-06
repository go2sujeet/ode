import { clearActiveRequest, getSessionsWithPendingRequests } from "@/config/local/sessions";
import type { IMAdapter } from "@/core/types";
import { log } from "@/utils";

export async function recoverPendingRequests(im: IMAdapter): Promise<void> {
  const pendingSessions = getSessionsWithPendingRequests();

  if (pendingSessions.length === 0) {
    log.info("No pending requests to recover");
    return;
  }

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

    await im.updateMessage(
      request.channelId,
      request.statusMessageTs,
      "_Bot restarted - please resend your message_",
      false
    );

    clearActiveRequest(session.channelId, session.threadId);
  }
}
