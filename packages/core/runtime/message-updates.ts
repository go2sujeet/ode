import type { IMAdapter } from "@/core/types";
import { resolveMessageUpdateIntervalMs } from "@/config";
import { log } from "@/utils";

type QueuedUpdate = {
  channelId: string;
  messageTs: string;
  text: string;
  asMarkdown: boolean;
  resolve: () => void;
};

function isRateLimitError(error: unknown): boolean {
  const message = String(error || "").toLowerCase();
  return message.includes("429") || message.includes("rate limit") || message.includes("ratelimit") || message.includes("rate_limited");
}

export function createRateLimitedImAdapter(
  im: IMAdapter,
  intervalMs = resolveMessageUpdateIntervalMs()
): IMAdapter {
  let globalLastUpdateAt = 0;
  const queue: QueuedUpdate[] = [];
  let processing = false;
  const rateLimitedMessages = new Set<string>();

  function key(channelId: string, messageTs: string): string {
    return `${channelId}:${messageTs}`;
  }

  async function processQueue(): Promise<void> {
    if (processing || queue.length === 0) return;
    processing = true;

    while (queue.length > 0) {
      const elapsed = Date.now() - globalLastUpdateAt;
      if (elapsed < intervalMs) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs - elapsed));
      }

      const item = queue.shift();
      if (!item) break;

      globalLastUpdateAt = Date.now();
      try {
        await im.updateMessage(item.channelId, item.messageTs, item.text, item.asMarkdown);
      } catch (error) {
        if (isRateLimitError(error)) {
          rateLimitedMessages.add(key(item.channelId, item.messageTs));
          log.warn("IM message update hit rate limit (429)", {
            channelId: item.channelId,
            messageTs: item.messageTs,
            error: String(error),
          });
        }
        log.debug("IM message update failed", {
          channelId: item.channelId,
          messageTs: item.messageTs,
          error: String(error),
        });
      }

      item.resolve();
    }

    processing = false;
  }

  return {
    ...im,
    wasRateLimited: (channelId: string, messageTs: string): boolean => {
      if (typeof im.wasRateLimited === "function" && im.wasRateLimited(channelId, messageTs)) {
        return true;
      }
      return rateLimitedMessages.has(key(channelId, messageTs));
    },
    updateMessage: async (
      channelId: string,
      messageTs: string,
      text: string,
      asMarkdown = true
    ): Promise<void> => {
      for (let i = queue.length - 1; i >= 0; i--) {
        const queued = queue[i];
        if (queued && queued.channelId === channelId && queued.messageTs === messageTs) {
          queue.splice(i, 1);
          queued.resolve();
        }
      }

      return new Promise<void>((resolve) => {
        queue.push({ channelId, messageTs, text, asMarkdown, resolve });
        void processQueue();
      });
    },
  };
}
