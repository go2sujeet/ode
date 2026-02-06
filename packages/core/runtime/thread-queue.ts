import { log } from "@/utils";

type QueueItem<TContext> = {
  context: TContext;
  text: string;
};

type QueueState<TContext> = {
  processing: boolean;
  items: QueueItem<TContext>[];
};

type QueueConfig<TContext> = {
  getKey: (context: TContext) => string;
  process: (context: TContext, text: string) => Promise<void>;
};

export class ThreadMessageQueue<TContext> {
  private readonly queues = new Map<string, QueueState<TContext>>();
  private readonly getKey: QueueConfig<TContext>["getKey"];
  private readonly process: QueueConfig<TContext>["process"];

  constructor(config: QueueConfig<TContext>) {
    this.getKey = config.getKey;
    this.process = config.process;
  }

  enqueue(context: TContext, text: string): void {
    const queueKey = this.getKey(context);
    const queue = this.queues.get(queueKey) ?? { processing: false, items: [] };
    queue.items.push({ context, text });
    this.queues.set(queueKey, queue);

    if (!queue.processing) {
      void this.processQueue(queueKey);
    }
  }

  private async processQueue(queueKey: string): Promise<void> {
    const queue = this.queues.get(queueKey);
    if (!queue || queue.processing) return;

    queue.processing = true;
    while (queue.items.length > 0) {
      const batch = queue.items.splice(0);
      const next = batch[0];
      if (!next) continue;
      const combinedText = batch.map((item) => item.text).join("\n");
      try {
        await this.process(next.context, combinedText);
      } catch (err) {
        log.error("Queued message processing failed", { error: String(err) });
      }
    }
    queue.processing = false;

    if (queue.items.length === 0) {
      this.queues.delete(queueKey);
      return;
    }

    void this.processQueue(queueKey);
  }
}
