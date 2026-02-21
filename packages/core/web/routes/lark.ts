import type { Elysia } from "elysia";
import { handleLarkEventPayload } from "@/ims";
import { jsonResponse, runRoute } from "../http";

type LarkRouteSpec = {
  path: string;
};

const LARK_EVENT_ROUTES: LarkRouteSpec[] = [
  { path: "/api/lark/event" },
  { path: "/api/lark-event" },
];

function registerLarkRoute(app: Elysia, spec: LarkRouteSpec): void {
  app.post(spec.path, async ({ request }: { request: Request }) => {
    return runRoute(
      async () => {
        const payload = await request.json();
        return handleLarkEventPayload(payload);
      },
      (response) => jsonResponse(response.status, response.body as { ok: boolean; error?: string; result?: unknown }),
      { fallbackMessage: "Lark event handling failed", status: 500 }
    );
  });
}

export function registerLarkRoutes(app: Elysia): void {
  for (const spec of LARK_EVENT_ROUTES) {
    registerLarkRoute(app, spec);
  }
}
