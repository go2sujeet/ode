import Redis from "ioredis";
import { log } from "@/utils";

let redis: Redis | null = null;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const AGENT_SESSION_LIMIT = 10;

export type SessionAgentProvider = "opencode" | "claude";

const SESSION_PREFIXES: SessionAgentProvider[] = ["opencode", "claude"];

export function toRedisSessionId(sessionId: string, agentProvider: SessionAgentProvider): string {
  const trimmed = sessionId.trim();
  for (const prefix of SESSION_PREFIXES) {
    if (trimmed.startsWith(`${prefix}_`)) {
      return trimmed;
    }
  }
  return `${agentProvider}_${trimmed}`;
}

function getSessionEventsKey(redisSessionId: string): string {
  return `session:events:${redisSessionId}`;
}

function getSessionMetaKey(redisSessionId: string): string {
  return `session:meta:${redisSessionId}`;
}

function getAgentSessionsKey(agentProvider: SessionAgentProvider): string {
  return `sessions:agent:${agentProvider}`;
}

async function enforceAgentSessionLimit(
  client: Redis,
  agentProvider: SessionAgentProvider
): Promise<void> {
  const agentKey = getAgentSessionsKey(agentProvider);
  const total = await client.zcard(agentKey);
  const overflow = total - AGENT_SESSION_LIMIT;
  if (overflow <= 0) return;

  const staleSessionIds = await client.zrange(agentKey, 0, overflow - 1);
  if (staleSessionIds.length === 0) return;

  const multi = client.multi();
  multi.zrem(agentKey, ...staleSessionIds);
  multi.zrem("sessions:all", ...staleSessionIds);
  for (const redisSessionId of staleSessionIds) {
    multi.del(getSessionMetaKey(redisSessionId));
    multi.del(getSessionEventsKey(redisSessionId));
  }
  await multi.exec();
}

export interface SessionEvent {
  timestamp: number;
  type: string;
  sessionId: string;
  agentProvider: SessionAgentProvider;
  channelId: string;
  threadId: string;
  data: Record<string, unknown>;
}

export interface SessionMeta {
  sessionId: string;
  agentProvider: SessionAgentProvider;
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
    const redisSessionId = toRedisSessionId(event.sessionId, event.agentProvider);
    const key = getSessionEventsKey(redisSessionId);
    await client.zadd(
      key,
      event.timestamp,
      JSON.stringify({
        ...event,
        sessionId: redisSessionId,
      })
    );
    await client.expire(key, SESSION_TTL_SECONDS);
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
    const redisSessionId = toRedisSessionId(meta.sessionId, meta.agentProvider);
    const key = getSessionMetaKey(redisSessionId);
    const agentKey = getAgentSessionsKey(meta.agentProvider);

    await client.hset(key, {
      sessionId: redisSessionId,
      agentProvider: meta.agentProvider,
      channelId: meta.channelId,
      threadId: meta.threadId,
      workingDirectory: meta.workingDirectory,
      createdAt: meta.createdAt.toString(),
      lastActivityAt: meta.lastActivityAt.toString(),
      threadOwnerUserId: meta.threadOwnerUserId || "",
      slackAppId: meta.slackAppId || "",
    });

    await client.zadd("sessions:all", meta.lastActivityAt, redisSessionId);
    await client.zadd(agentKey, meta.lastActivityAt, redisSessionId);
    await client.expire(key, SESSION_TTL_SECONDS);
    await client.expire(agentKey, SESSION_TTL_SECONDS);
    await enforceAgentSessionLimit(client, meta.agentProvider);
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
    const key = getSessionEventsKey(sessionId);
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
    const key = getSessionMetaKey(sessionId);
    const data = await client.hgetall(key);
    if (
      !data ||
      !data.sessionId ||
      !data.channelId ||
      !data.threadId ||
      !data.workingDirectory ||
      !data.createdAt ||
      !data.lastActivityAt
    ) {
      return null;
    }
    const inferredAgentProvider: SessionAgentProvider =
      data.agentProvider === "claude" || data.sessionId.startsWith("claude_")
        ? "claude"
        : "opencode";
    return {
      sessionId: data.sessionId,
      agentProvider: inferredAgentProvider,
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
