import Redis from "ioredis";
import { log } from "@ode/utils";

let redis: Redis | null = null;

export interface SessionEvent {
  timestamp: number;
  type: string;
  sessionId: string;
  channelId: string;
  threadId: string;
  data: Record<string, unknown>;
}

export interface SessionMeta {
  sessionId: string;
  channelId: string;
  threadId: string;
  workingDirectory: string;
  createdAt: number;
  lastActivityAt: number;
  threadOwnerUserId?: string;
  slackAppId?: string;
}

export function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    redis.on("error", (err: Error) => {
      log.error("Redis connection error", { error: String(err) });
    });

    redis.on("connect", () => {
      log.info("Redis connected");
    });

    void redis.connect().catch((err: Error) => {
      log.error("Failed to connect to Redis", { error: String(err) });
    });
  }
  return redis;
}

export async function storeSessionEvent(event: SessionEvent): Promise<void> {
  try {
    const client = getRedisClient();
    const key = `session:events:${event.sessionId}`;
    await client.zadd(key, event.timestamp, JSON.stringify(event));
    await client.expire(key, 7 * 24 * 60 * 60);
  } catch (err) {
    log.error("Failed to store session event", {
      sessionId: event.sessionId,
      error: String(err),
    });
  }
}

export async function storeSessionMeta(meta: SessionMeta): Promise<void> {
  try {
    const client = getRedisClient();
    const key = `session:meta:${meta.sessionId}`;

    await client.hset(key, {
      sessionId: meta.sessionId,
      channelId: meta.channelId,
      threadId: meta.threadId,
      workingDirectory: meta.workingDirectory,
      createdAt: meta.createdAt.toString(),
      lastActivityAt: meta.lastActivityAt.toString(),
      threadOwnerUserId: meta.threadOwnerUserId || "",
      slackAppId: meta.slackAppId || "",
    });

    await client.zadd("sessions:all", meta.lastActivityAt, meta.sessionId);
    await client.expire(key, 7 * 24 * 60 * 60);
  } catch (err) {
    log.error("Failed to store session meta", {
      sessionId: meta.sessionId,
      error: String(err),
    });
  }
}

export async function getSessionEvents(sessionId: string): Promise<SessionEvent[]> {
  try {
    const client = getRedisClient();
    const key = `session:events:${sessionId}`;
    const events = await client.zrange(key, 0, -1);
    return events.map((eventStr: string) => JSON.parse(eventStr) as SessionEvent);
  } catch (err) {
    log.error("Failed to get session events", { sessionId, error: String(err) });
    return [];
  }
}

export async function getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
  try {
    const client = getRedisClient();
    const key = `session:meta:${sessionId}`;
    const data = await client.hgetall(key);
    if (!data || !data.sessionId) return null;
    return {
      sessionId: data.sessionId,
      channelId: data.channelId,
      threadId: data.threadId,
      workingDirectory: data.workingDirectory,
      createdAt: parseInt(data.createdAt, 10),
      lastActivityAt: parseInt(data.lastActivityAt, 10),
      threadOwnerUserId: data.threadOwnerUserId || undefined,
      slackAppId: data.slackAppId || undefined,
    };
  } catch (err) {
    log.error("Failed to get session meta", { sessionId, error: String(err) });
    return null;
  }
}

export async function getAllSessions(): Promise<SessionMeta[]> {
  try {
    const client = getRedisClient();
    const sessionIds = await client.zrevrange("sessions:all", 0, -1);
    const sessions: SessionMeta[] = [];
    for (const sessionId of sessionIds) {
      const meta = await getSessionMeta(sessionId);
      if (meta) sessions.push(meta);
    }
    return sessions;
  } catch (err) {
    log.error("Failed to get all sessions", { error: String(err) });
    return [];
  }
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
