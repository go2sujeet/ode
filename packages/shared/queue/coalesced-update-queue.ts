import Bottleneck from "bottleneck";

type QueueKey = {
  channelId: string;
  messageId: string;
};

type PendingItem<TResult> = {
  key: QueueKey;
  payload: string;
  resolve: (value: TResult) => void;
};

export class CoalescedUpdateQueue<TResult> {
  private readonly limiter: Bottleneck;
  private readonly pendingByKey = new Map<string, PendingItem<TResult>>();

  constructor(
    minTimeMs: number,
    private readonly worker: (key: QueueKey, payload: string) => Promise<TResult>
  ) {
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: Math.max(minTimeMs, 0),
    });
  }

  enqueue(key: QueueKey, payload: string): Promise<TResult> {
    const dedupKey = this.buildKey(key);
    const existing = this.pendingByKey.get(dedupKey);
    if (existing) {
      existing.resolve(undefined as TResult);
      this.pendingByKey.delete(dedupKey);
    }

    return new Promise<TResult>((resolve) => {
      this.pendingByKey.set(dedupKey, {
        key,
        payload,
        resolve,
      });
      void this.limiter.schedule(async () => {
        const pending = this.pendingByKey.get(dedupKey);
        if (!pending) return;
        this.pendingByKey.delete(dedupKey);
        const result = await this.worker(pending.key, pending.payload);
        pending.resolve(result);
      });
    });
  }

  clear(): void {
    for (const pending of this.pendingByKey.values()) {
      pending.resolve(undefined as TResult);
    }
    this.pendingByKey.clear();
    void this.limiter.stop({ dropWaitingJobs: true });
  }

  private buildKey(key: QueueKey): string {
    return `${key.channelId}:${key.messageId}`;
  }
}
