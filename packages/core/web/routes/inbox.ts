import type { Elysia } from "elysia";
import {
  getMessageThreadById,
  getMessageThreadPage,
} from "@/config/local/inbox";
import { jsonResponse, parsePositiveInt, runRoute } from "../http";

export function registerInboxRoutes(app: Elysia): void {
  // Thread list — each item is a conversation with aggregate counters.
  app.get("/api/message-threads", async ({ query }: { query: Record<string, string | undefined> }) => {
    return runRoute(
      async () => {
        const page = parsePositiveInt(typeof query.page === "string" ? query.page : null, 1);
        const pageSize = parsePositiveInt(typeof query.pageSize === "string" ? query.pageSize : null, 20, 100);
        return getMessageThreadPage({ page, pageSize });
      },
      (result) => jsonResponse(200, { ok: true, result }),
      { fallbackMessage: "Internal server error", status: 500 }
    );
  });

  // Thread detail — returns the thread row plus all its message_detail rows
  // (user prompts, agent results, questions, replies) ordered by seq.
  app.get("/api/message-threads/:id", async ({ params }: { params: { id?: string } }) => {
    return runRoute(
      async () => {
        const id = params.id?.trim();
        if (!id) {
          throw new Error("Missing thread id");
        }
        const thread = getMessageThreadById(id);
        if (!thread) {
          throw new Error("Thread not found");
        }
        return thread;
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Internal server error",
        resolveStatus: (message) => {
          if (message === "Missing thread id") return 400;
          if (message === "Thread not found") return 404;
          return 500;
        },
      }
    );
  });
}
