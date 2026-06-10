import type { Elysia } from "elysia";
import { defaultDashboardConfig, sanitizeDashboardConfig } from "@/config";
import { readLocalSettings, writeLocalSettings } from "../local-settings";
import { jsonResponse, runRoute } from "../http";
import { validateWorkspaceConfig } from "../config-validation";
import { APP_VERSION } from "../version";

function isDevEnabled(): boolean {
  const value = process.env.ODE_DEV?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function registerConfigRoutes(app: Elysia): void {
  app.get("/api/config", async () => {
    const config = await readLocalSettings();
    return jsonResponse(200, {
      ok: true,
      config: config as typeof defaultDashboardConfig,
      version: APP_VERSION,
      dev: { enabled: isDevEnabled() },
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
        dev: { enabled: isDevEnabled() },
      }),
      { fallbackMessage: "Invalid payload", status: 400 }
    );
  });
}
