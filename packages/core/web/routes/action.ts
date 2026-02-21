import type { Elysia } from "elysia";
import { handleDiscordActionPayload, handleLarkActionPayload, handleSlackActionPayload } from "@/ims";
import { attachDiscordBotToken, attachLarkCredentials } from "../config-validation";
import { jsonResponse, readJsonBody, runRoute } from "../http";

export function registerActionRoutes(app: Elysia): void {
  app.post("/api/action", async ({ request }: { request: Request }) => {
    return runRoute(
      async () => {
        const payload = await readJsonBody(request);
        const platform = payload && typeof payload === "object" && "platform" in payload
          ? String((payload as { platform?: unknown }).platform ?? "slack").toLowerCase()
          : "slack";

        if (platform === "discord") {
          attachDiscordBotToken(payload);
        } else if (platform === "lark") {
          attachLarkCredentials(payload);
        }

        const response = platform === "discord"
          ? await handleDiscordActionPayload(payload)
          : platform === "lark"
            ? await handleLarkActionPayload(payload)
            : await handleSlackActionPayload(payload);
        return response;
      },
      (response) => jsonResponse(response.ok ? 200 : 400, response),
      {
        fallbackMessage: "Invalid JSON payload",
        resolveStatus: (message) => (message === "Invalid JSON payload" ? 400 : 500),
      }
    );
  });
}
