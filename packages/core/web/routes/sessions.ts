import type { Elysia } from "elysia";
import {
  getAllSessions,
  getHarnessRunEventsAsSession,
  getHarnessRunMetaAsSession,
  getHarnessRunsAsSessions,
  getSessionEvents,
  getSessionMeta,
} from "@/config/local/redis";
import { collapseTextDeltas } from "../session-events";
import { jsonResponse, parsePositiveInt, runRoute } from "../http";

const DEFAULT_SESSION_EVENTS_LIMIT = 2000;
const MAX_SESSION_EVENTS_LIMIT = 10000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function extractTextFromContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return asText(value);
  }
  if (!Array.isArray(value)) return undefined;

  const parts: string[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const text = asText(record.text)
      ?? asText(record.content)
      ?? asText(record.think);
    if (text) parts.push(text);
  }
  const combined = parts.join("\n").trim();
  return combined || undefined;
}

function normalizePrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

function extractPromptFromEventData(data: Record<string, unknown>): string | undefined {
  const payload = asRecord(data.payload) ?? data;
  const props = asRecord(payload.properties) ?? payload;
  const record = asRecord(props.record);
  const message = asRecord(props.message)
    ?? asRecord(record?.message);
  const request = asRecord(props.request);

  const directPrompt = asText(props.prompt)
    ?? asText(request?.prompt)
    ?? asText(record?.prompt)
    ?? asText(record?.input)
    ?? asText(record?.question);
  if (directPrompt) return normalizePrompt(directPrompt);

  const messageRole = asText(message?.role)?.toLowerCase();
  if (messageRole === "user") {
    const prompt = extractTextFromContent(message?.content)
      ?? asText(message?.text);
    if (prompt) return normalizePrompt(prompt);
  }

  const recordType = asText(record?.type)?.toLowerCase();
  if (recordType === "user") {
    const prompt = extractTextFromContent(asRecord(record?.message)?.content)
      ?? extractTextFromContent(record?.content)
      ?? asText(record?.text);
    if (prompt) return normalizePrompt(prompt);
  }

  return undefined;
}

async function inferInitialPrompt(sessionId: string): Promise<string | undefined> {
  let events = await getSessionEvents(sessionId);
  if (events.length === 0) {
    events = await getHarnessRunEventsAsSession(sessionId);
  }
  if (events.length === 0) return undefined;

  const sortedEvents = events
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  for (const event of sortedEvents) {
    const prompt = extractPromptFromEventData(event.data);
    if (prompt) return prompt;
  }
  return undefined;
}

function requireSessionId(sessionId?: string): string {
  if (!sessionId) {
    throw new Error("Missing session id");
  }
  return sessionId;
}

function resolveSessionIdErrorStatus(message: string): number {
  return message === "Missing session id" ? 400 : 500;
}

export function registerSessionRoutes(app: Elysia): void {
  app.get("/api/sessions", async () => {
    return runRoute(
      async () => {
        const [sessions, harnessSessions] = await Promise.all([
          getAllSessions(),
          getHarnessRunsAsSessions(),
        ]);
        const merged = [...sessions, ...harnessSessions]
          .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
          .filter((session, index, all) => all.findIndex((item) => item.sessionId === session.sessionId) === index);

        return Promise.all(
          merged.map(async (session) => {
            if (session.initialPrompt) return session;
            const initialPrompt = await inferInitialPrompt(session.sessionId);
            return initialPrompt ? { ...session, initialPrompt } : session;
          })
        );
      },
      (result) => jsonResponse(200, { ok: true, result }),
      { fallbackMessage: "Internal server error", status: 500 }
    );
  });

  app.get("/api/sessions/:sessionId/events", async ({ params, query }: {
    params: { sessionId?: string };
    query: Record<string, string | undefined>;
  }) => {
    return runRoute(
      async () => {
        const sessionId = requireSessionId(params.sessionId);
        const expand = query.expand === "true";
        const sinceRaw = typeof query.since === "string" ? query.since : null;
        const sinceTs = sinceRaw ? parseInt(sinceRaw, 10) : null;
        const hasValidSince = sinceTs !== null && !Number.isNaN(sinceTs);
        const limit = parsePositiveInt(
          typeof query.limit === "string" ? query.limit : null,
          DEFAULT_SESSION_EVENTS_LIMIT,
          MAX_SESSION_EVENTS_LIMIT
        );
        let events = await getSessionEvents(sessionId, {
          since: hasValidSince ? sinceTs : undefined,
          limit: hasValidSince ? undefined : limit,
        });
        if (events.length === 0) {
          events = await getHarnessRunEventsAsSession(sessionId, {
            since: hasValidSince ? sinceTs : undefined,
            limit: hasValidSince ? undefined : limit,
          });
        }

        if (expand) {
          return hasValidSince ? events.filter((event) => event.timestamp > sinceTs) : events;
        }
        const collapsed = collapseTextDeltas(events);
        return hasValidSince ? collapsed.filter((event) => event.timestamp > sinceTs) : collapsed;
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Internal server error",
        resolveStatus: resolveSessionIdErrorStatus,
      }
    );
  });

  app.get("/api/sessions/:sessionId", async ({ params }: { params: { sessionId?: string } }) => {
    return runRoute(
      async () => {
        const sessionId = requireSessionId(params.sessionId);
        const meta = await getSessionMeta(sessionId) ?? await getHarnessRunMetaAsSession(sessionId);
        if (!meta) {
          throw new Error("Session not found");
        }
        return meta;
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Internal server error",
        resolveStatus: (message) => {
          if (message === "Missing session id") return 400;
          if (message === "Session not found") return 404;
          return 500;
        },
      }
    );
  });
}
