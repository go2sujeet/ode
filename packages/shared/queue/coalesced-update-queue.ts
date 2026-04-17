import Bottleneck from "bottleneck";

type QueueKey = {
  channelId: string;
  messageId: string;
};

type PendingItem<TResult, TPayload> = {
  key: QueueKey;
  payload: TPayload;
  resolve: (value: TResult) => void;
};

export class CoalescedUpdateQueue<TResult, TPayload = string> {
  private readonly limiter: Bottleneck;
  private readonly pendingByKey = new Map<string, PendingItem<TResult, TPayload>>();
  private stopped = false;

  constructor(
    minTimeMs: number,
    private readonly worker: (key: QueueKey, payload: TPayload) => Promise<TResult>
  ) {
    this.limiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: Math.max(minTimeMs, 0),
    });
  }

  enqueue(key: QueueKey, payload: TPayload): Promise<TResult> {
    const dedupKey = this.buildKey(key);
    this.resolvePending(dedupKey);

    return new Promise<TResult>((resolve) => {
      if (this.stopped) {
        // Queue was already torn down; resolve immediately so callers don't
        // hang on a stopped limiter.
        resolve(undefined as TResult);
        return;
      }
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

  cancel(key: QueueKey): void {
    this.resolvePending(this.buildKey(key));
  }

  /**
   * Tear down the queue. Idempotent — calling `clear()` more than once (for
   * example when a shutdown runs twice because the operator hit Ctrl+C
   * twice) is a no-op, because `Bottleneck.stop()` itself is single-shot and
   * throws if invoked again.
   */
  clear(): void {
    for (const pending of this.pendingByKey.values()) {
      pending.resolve(undefined as TResult);
    }
    this.pendingByKey.clear();
    if (this.stopped) return;
    this.stopped = true;
    void this.limiter.stop({ dropWaitingJobs: true });
  }

  private buildKey(key: QueueKey): string {
    return `${key.channelId}:${key.messageId}`;
  }

  private resolvePending(dedupKey: string): void {
    const existing = this.pendingByKey.get(dedupKey);
    if (!existing) return;
    existing.resolve(undefined as TResult);
    this.pendingByKey.delete(dedupKey);
  }
}
