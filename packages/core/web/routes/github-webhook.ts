import type { Elysia } from "elysia";
import { processWebhookPayload } from "@/ims/github";
import { handleGitHubWebhookEvent } from "@/ims/github";
import { jsonResponse, runRoute } from "../http";

export function registerGitHubWebhookRoutes(app: Elysia): void {
  app.post("/api/github/webhook", async ({ request }: { request: Request }) => {
    return runRoute(
      async () => {
        const signature = request.headers.get("x-hub-signature-256") || "";
        const eventHeader = request.headers.get("x-github-event") || "";
        const body = await request.text();

        if (!eventHeader) {
          throw new Error("Missing x-github-event header");
        }
        if (!signature) {
          throw new Error("Missing x-hub-signature-256 header");
        }

        const result = await processWebhookPayload({ body, signature, eventHeader });

        if (result.kind === "ignored") {
          return { action: "ignored", reason: result.reason };
        }

        await handleGitHubWebhookEvent(result.event);
        return { action: "forwarded", issue: result.event.threadId, repo: result.event.channelId };
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Failed to process GitHub webhook",
        resolveStatus: (message) => {
          if (message === "Missing x-github-event header") return 400;
          if (message === "Missing x-hub-signature-256 header") return 400;
          if (message === "signature_mismatch") return 401;
          return 500;
        },
      },
    );
  });
}
