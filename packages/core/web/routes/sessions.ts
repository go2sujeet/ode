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
        return [...sessions, ...harnessSessions]
          .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
          .filter((session, index, all) => all.findIndex((item) => item.sessionId === session.sessionId) === index);
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
