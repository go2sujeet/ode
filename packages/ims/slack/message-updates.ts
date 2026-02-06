import { markdownToSlack, truncateForSlack } from "./formatter";
import { log } from "@/utils";

type QueuedUpdate = {
  channelId: string;
  messageTs: string;
  text: string;
  asMarkdown: boolean;
  resolve: () => void;
};

export function createThrottledMessageUpdater(deps: {
  getApp: () => { client: { chat: { update: (args: any) => Promise<unknown> } } };
  getChannelBotToken: (channelId: string) => string | undefined;
}) {
  let globalLastUpdate = 0;
  const GLOBAL_UPDATE_INTERVAL_MS = 1000;
  const globalUpdateQueue: QueuedUpdate[] = [];
  let globalQueueProcessing = false;

  async function processGlobalUpdateQueue(): Promise<void> {
    if (globalQueueProcessing || globalUpdateQueue.length === 0) return;
    globalQueueProcessing = true;

    while (globalUpdateQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastUpdate = now - globalLastUpdate;

      if (timeSinceLastUpdate < GLOBAL_UPDATE_INTERVAL_MS) {
        await new Promise((r) => setTimeout(r, GLOBAL_UPDATE_INTERVAL_MS - timeSinceLastUpdate));
      }

      const item = globalUpdateQueue.shift();
      if (!item) break;

      globalLastUpdate = Date.now();

      try {
        const slackApp = deps.getApp();
        const formattedText = item.asMarkdown ? markdownToSlack(item.text) : item.text;
        const truncatedText = truncateForSlack(formattedText);

        const botToken = deps.getChannelBotToken(item.channelId);
        if (!botToken) {
          log.warn("No Slack bot token available for message update", { channelId: item.channelId });
        }
        await slackApp.client.chat.update({
          channel: item.channelId,
          ts: item.messageTs,
          text: truncatedText,
          token: botToken,
        });
      } catch (err) {
        log.debug("Failed to update message", { error: String(err) });
      }

      item.resolve();
    }

    globalQueueProcessing = false;
  }

  return async function updateMessageThrottled(
    channelId: string,
    messageTs: string,
    text: string,
    asMarkdown = true
  ): Promise<void> {
    for (let i = globalUpdateQueue.length - 1; i >= 0; i--) {
      const item = globalUpdateQueue[i];
      if (item && item.channelId === channelId && item.messageTs === messageTs) {
        globalUpdateQueue.splice(i, 1);
        item.resolve();
      }
    }

    return new Promise<void>((resolve) => {
      globalUpdateQueue.push({ channelId, messageTs, text, asMarkdown, resolve });
      void processGlobalUpdateQueue();
    });
  };
}
