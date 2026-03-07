import type { IMAdapter } from "@/core/types";
import { getMessageUpdateIntervalMs } from "@/config";
import { log } from "@/utils";
import { CoalescedUpdateQueue } from "@/shared/queue/coalesced-update-queue";

function isRateLimitError(error: unknown): boolean {
  const message = String(error || "").toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("ratelimit") || message.includes("rate_limited");
}

export function createRateLimitedImAdapter(
  im: IMAdapter,
  intervalMs = getMessageUpdateIntervalMs()
): IMAdapter {
  const rateLimitedMessages = new Set<string>();
  const rateLimitErrors = new Map<string, string>();
  const updateErrors = new Map<string, string>();

  function key(channelId: string, messageTs: string): string {
    return `${channelId}:${messageTs}`;
  }

  const queue = new CoalescedUpdateQueue<string | undefined>(
    intervalMs,
    async ({ channelId, messageId }, text) => {
      try {
        const maybeUpdatedTs = await im.updateMessage(channelId, messageId, text);
        updateErrors.delete(key(channelId, messageId));
        return typeof maybeUpdatedTs === "string" ? maybeUpdatedTs : undefined;
      } catch (error) {
        const errorText = String(error);
        const updateErrorKey = key(channelId, messageId);
        updateErrors.set(updateErrorKey, errorText);
        if (isRateLimitError(error)) {
          rateLimitedMessages.add(updateErrorKey);
          rateLimitErrors.set(updateErrorKey, errorText);
          log.warn("IM message update hit rate limit (429)", {
            channelId,
            messageTs: messageId,
            error: errorText,
          });
        }
        log.debug("IM message update failed", {
          channelId,
          messageTs: messageId,
          error: errorText,
        });
        return undefined;
      }
    }
  );

  return {
    ...im,
    wasRateLimited: (channelId: string, messageTs: string): boolean => {
      if (typeof im.wasRateLimited === "function" && im.wasRateLimited(channelId, messageTs)) {
        return true;
      }
      return rateLimitedMessages.has(key(channelId, messageTs));
    },
    getRateLimitError: (channelId: string, messageTs: string): string | undefined => {
      if (typeof im.getRateLimitError === "function") {
        const upstream = im.getRateLimitError(channelId, messageTs);
        if (upstream) return upstream;
      }
      return rateLimitErrors.get(key(channelId, messageTs));
    },
    takeUpdateError: (channelId: string, messageTs: string): string | undefined => {
      const updateErrorKey = key(channelId, messageTs);
      if (typeof im.takeUpdateError === "function") {
        const upstream = im.takeUpdateError(channelId, messageTs);
        if (upstream) {
          updateErrors.delete(updateErrorKey);
          return upstream;
        }
      }
      const captured = updateErrors.get(updateErrorKey);
      if (!captured) return undefined;
      updateErrors.delete(updateErrorKey);
      return captured;
    },
    updateMessage: async (
      channelId: string,
      messageTs: string,
      text: string
    ): Promise<string | undefined> => {
      return queue.enqueue({ channelId, messageId: messageTs }, text);
    },
  };
}
