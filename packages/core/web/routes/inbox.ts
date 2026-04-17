import type { Elysia } from "elysia";
import { getInboxPage, getInboxRecordById } from "@/config/local/inbox";
import { jsonResponse, parsePositiveInt, runRoute } from "../http";

export function registerInboxRoutes(app: Elysia): void {
  app.get("/api/inbox", async ({ query }: { query: Record<string, string | undefined> }) => {
    return runRoute(
      async () => {
        const page = parsePositiveInt(typeof query.page === "string" ? query.page : null, 1);
        const pageSize = parsePositiveInt(typeof query.pageSize === "string" ? query.pageSize : null, 20, 100);
        return getInboxPage({ page, pageSize });
      },
      (result) => jsonResponse(200, { ok: true, result }),
      { fallbackMessage: "Internal server error", status: 500 }
    );
  });

  app.get("/api/inbox/:id", async ({ params }: { params: { id?: string } }) => {
    return runRoute(
      async () => {
        const id = params.id?.trim();
        if (!id) {
          throw new Error("Missing inbox id");
        }
        const record = getInboxRecordById(id);
        if (!record) {
          throw new Error("Inbox record not found");
        }
        return record;
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Internal server error",
        resolveStatus: (message) => {
          if (message === "Missing inbox id") return 400;
          if (message === "Inbox record not found") return 404;
          return 500;
        },
      }
    );
  });
}
