import type { Elysia } from "elysia";
import { log } from "@/utils";
import { runAgentCheck } from "../agent-check";
import { jsonResponse } from "../http";

export function registerAgentCheckRoutes(app: Elysia): void {
  app.get("/api/agent-check", async () => {
    const result = await runAgentCheck();
    if (result.opencodeModelError) {
      log.warn("Failed to query OpenCode models during agent check", {
        error: result.opencodeModelError,
      });
    }
    if (result.kiloModelError) {
      log.warn("Failed to query Kilo models during agent check", {
        error: result.kiloModelError,
      });
    }
    return jsonResponse(200, {
      ok: true,
      result,
    });
  });
}
