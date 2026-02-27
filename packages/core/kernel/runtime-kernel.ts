import type { InboundDecision } from "@/core/model/inbound-decision";
import type { BotKey } from "@/core/model/bot-key";
import { toBotKeyId } from "@/core/model/bot-key";
import type { RawInboundEvent } from "@/core/model/raw-inbound-event";
import type { ThreadKey } from "@/core/model/thread-key";
import { toThreadKeyId } from "@/core/model/thread-key";
import type { InboundAdapter } from "@/ims/shared/inbound-adapter";

type QueuedInbound = {
  event: RawInboundEvent;
  decision: InboundDecision;
};

type ThreadRuntimeRegistryDeps = {
  onDecision: (threadKey: ThreadKey, params: { event: RawInboundEvent; decision: InboundDecision }) => Promise<void>;
  ttlMs: number;
  sweepIntervalMs: number;
};

type BotRuntimeDeps = {
  inboundAdapter: InboundAdapter;
  threadRuntimeRegistry: ThreadRuntimeRegistry;
};

type RuntimeKernelDeps = {
  createBotRuntime: (botKey: BotKey) => BotRuntime;
};

export class ThreadRuntime {
  private readonly queue: QueuedInbound[] = [];
  private processing = false;
  private touchedAtMs = Date.now();

  constructor(
    private readonly threadKey: ThreadKey,
    private readonly onDecision: (threadKey: ThreadKey, queued: QueuedInbound) => Promise<void>
  ) {}

  getLastTouchedAtMs(): number {
    return this.touchedAtMs;
  }

  async enqueue(event: RawInboundEvent, decision: InboundDecision): Promise<void> {
    this.touchedAtMs = Date.now();
    this.queue.push({ event, decision });
    if (this.processing) return;
    await this.drain();
  }

  private async drain(): Promise<void> {
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const queued = this.queue.shift();
        if (!queued) continue;
        await this.onDecision(this.threadKey, queued);
      }
    } finally {
      this.processing = false;
    }
  }
}

export class ThreadRuntimeRegistry {
  private readonly runtimes = new Map<string, ThreadRuntime>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor(private readonly deps: ThreadRuntimeRegistryDeps) {
    this.sweeper = setInterval(() => this.sweep(), this.deps.sweepIntervalMs);
  }

  getOrCreate(threadKey: ThreadKey): ThreadRuntime {
    const id = toThreadKeyId(threadKey);
    const existing = this.runtimes.get(id);
    if (existing) return existing;

    const runtime = new ThreadRuntime(threadKey, (nextThreadKey, params) => this.deps.onDecision(nextThreadKey, params));
    this.runtimes.set(id, runtime);
    return runtime;
  }

  shutdown(): void {
    clearInterval(this.sweeper);
    this.runtimes.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, runtime] of this.runtimes) {
      if (now - runtime.getLastTouchedAtMs() <= this.deps.ttlMs) continue;
      this.runtimes.delete(id);
    }
  }
}

export class BotRuntime {
  constructor(
    private readonly botKey: BotKey,
    private readonly deps: BotRuntimeDeps
  ) {}

  async handleInbound(event: RawInboundEvent): Promise<void> {
    const decision = this.deps.inboundAdapter.evaluate(event);

    if (decision.kind === "ignore") return;

    await this.enqueueToThreadRuntime(event, decision);
  }

  private async enqueueToThreadRuntime(event: RawInboundEvent, decision: InboundDecision): Promise<void> {
    const threadKey: ThreadKey = {
      botKey: this.botKey,
      channelId: event.channelId,
      threadId: event.threadId,
    };
    const threadRuntime = this.deps.threadRuntimeRegistry.getOrCreate(threadKey);
    await threadRuntime.enqueue(event, decision);
  }
}

export class RuntimeKernel {
  private readonly botRuntimes = new Map<string, BotRuntime>();

  constructor(private readonly deps: RuntimeKernelDeps) {}

  async handleInbound(event: RawInboundEvent): Promise<void> {
    const botKey: BotKey = {
      platform: event.platform,
      botId: event.botId,
    };
    const runtime = this.getOrCreateBotRuntime(botKey);
    await runtime.handleInbound(event);
  }

  private getOrCreateBotRuntime(botKey: BotKey): BotRuntime {
    const id = toBotKeyId(botKey);
    const existing = this.botRuntimes.get(id);
    if (existing) return existing;

    const runtime = this.deps.createBotRuntime(botKey);
    this.botRuntimes.set(id, runtime);
    return runtime;
  }
}
