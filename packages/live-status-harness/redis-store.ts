import Redis from "ioredis";
import type {
  HarnessCapturedEvent,
  HarnessRenderedStatus,
  HarnessRunMeta,
} from "./types";

const DEFAULT_PREFIX = "harness:live_status";

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class HarnessRedisStore {
  private readonly prefix: string;
  private readonly client: Redis;

  constructor(prefix = DEFAULT_PREFIX) {
    this.prefix = prefix;
    this.client = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: toNumber(process.env.REDIS_PORT, 6379),
      db: toNumber(process.env.REDIS_DB, 0),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  private key(suffix: string): string {
    return `${this.prefix}:${suffix}`;
  }

  async connect(): Promise<void> {
    if (this.client.status === "ready" || this.client.status === "connecting") return;
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  async saveRunMeta(meta: HarnessRunMeta): Promise<void> {
    const key = this.key(`runs:${meta.runId}:meta`);
    await this.client.set(key, JSON.stringify(meta));
    await this.client.zadd(this.key("runs:index"), meta.startedAt, meta.runId);
  }

  async updateRunMeta(runId: string, update: Partial<HarnessRunMeta>): Promise<void> {
    const existing = await this.getRunMeta(runId);
    if (!existing) {
      throw new Error(`Run metadata not found for ${runId}`);
    }
    await this.saveRunMeta({ ...existing, ...update });
  }

  async appendEvent(event: HarnessCapturedEvent): Promise<void> {
    const key = this.key(`runs:${event.runId}:events`);
    await this.client.rpush(key, JSON.stringify(event));
  }

  async saveRenderedStatuses(runId: string, statuses: HarnessRenderedStatus[]): Promise<void> {
    const key = this.key(`runs:${runId}:rendered`);
    await this.client.set(key, JSON.stringify(statuses));
  }

  async getRunMeta(runId: string): Promise<HarnessRunMeta | null> {
    const value = await this.client.get(this.key(`runs:${runId}:meta`));
    if (!value) return null;
    return JSON.parse(value) as HarnessRunMeta;
  }

  async getRunEvents(runId: string): Promise<HarnessCapturedEvent[]> {
    const values = await this.client.lrange(this.key(`runs:${runId}:events`), 0, -1);
    return values.map((value) => JSON.parse(value) as HarnessCapturedEvent);
  }

  async getLatestRunId(): Promise<string | null> {
    return this.client.zrevrange(this.key("runs:index"), 0, 0).then((items) => items[0] ?? null);
  }

  async getLatestRunIdByProvider(provider: HarnessRunMeta["provider"]): Promise<string | null> {
    const runIds = await this.client.zrevrange(this.key("runs:index"), 0, -1);
    for (const runId of runIds) {
      const meta = await this.getRunMeta(runId);
      if (!meta || meta.provider !== provider) continue;
      const eventCount = await this.client.llen(this.key(`runs:${runId}:events`));
      if (eventCount > 0) {
        return runId;
      }
    }
    return null;
  }
}

export function buildHarnessRunId(provider: string): string {
  return `${provider}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}
