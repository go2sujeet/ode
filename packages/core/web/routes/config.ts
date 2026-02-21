import type { Elysia } from "elysia";
import { defaultDashboardConfig, sanitizeDashboardConfig } from "@/config";
import { readLocalSettings, writeLocalSettings } from "../local-settings";
import { jsonResponse, runRoute } from "../http";
import { validateWorkspaceConfig } from "../config-validation";
import { APP_VERSION } from "../version";

export function registerConfigRoutes(app: Elysia): void {
  app.get("/api/config", async () => {
    const config = await readLocalSettings();
    return jsonResponse(200, {
      ok: true,
      config: config as typeof defaultDashboardConfig,
      version: APP_VERSION,
    });
  });

  app.put("/api/config", async ({ request }: { request: Request }) => {
    return runRoute(
      async () => {
        const payload = await request.json();
        const sanitized = sanitizeDashboardConfig(payload);
        const validationError = validateWorkspaceConfig(sanitized);
        if (validationError) {
          throw new Error(validationError);
        }
        await writeLocalSettings(sanitized);
        return sanitized;
      },
      (sanitized) => jsonResponse(200, {
        ok: true,
        config: sanitized as typeof defaultDashboardConfig,
        version: APP_VERSION,
      }),
      { fallbackMessage: "Invalid payload", status: 400 }
    );
  });
}
