import type { Elysia } from "elysia";
import { addDiscordReaction, addLarkReaction, addSlackReaction } from "@/ims";
import { attachDiscordBotToken, attachLarkCredentials } from "../config-validation";
import { jsonResponse, readJsonBody, runRoute } from "../http";
import { resolveChannelLocator } from "./channel-resolver";

function getString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

function getOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function registerReactionsRoutes(app: Elysia): void {
  /**
   * Add a reaction emoji to a message. Powers `ode reaction add`. Accepts
   * the short reaction names (`thumbsup`, `eyes`, `ok_hand`) and dispatches
   * to the platform-specific helper based on the channel's configured
   * workspace type.
   */
  app.post("/api/reactions", async ({ request }: { request: Request }) => {
    return runRoute(
      async () => {
        const body = await readJsonBody(request);
        const channelIdRaw = getString(body, "channelId");
        const messageId = getString(body, "messageId");
        const emoji = getString(body, "emoji");
        if (!channelIdRaw) throw new Error("channelId is required");
        if (!messageId) throw new Error("messageId is required");
        if (!emoji) throw new Error("emoji is required");

        const threadId = getOptionalString(body, "threadId");
        const resolved = resolveChannelLocator(channelIdRaw);

        if (resolved.platform === "slack") {
          const result = await addSlackReaction({
            channelId: resolved.channelId,
            messageId,
            emoji,
            threadId,
          });
          return { platform: resolved.platform, ...result };
        }

        if (resolved.platform === "discord") {
          const discordPayload: Record<string, unknown> = { channelId: resolved.channelId };
          attachDiscordBotToken(discordPayload);
          const botToken = typeof discordPayload.botToken === "string" ? discordPayload.botToken : "";
          if (!botToken) {
            throw new Error("Discord bot token not configured");
          }
          const result = await addDiscordReaction({
            botToken,
            channelId: resolved.channelId,
            messageId,
            emoji,
          });
          return { platform: resolved.platform, ...result };
        }

        if (resolved.platform === "lark") {
          const larkPayload: Record<string, unknown> = {
            channelId: resolved.channelId,
            workspaceId: resolved.workspaceId,
          };
          attachLarkCredentials(larkPayload);
          const appId = typeof larkPayload.appId === "string" ? larkPayload.appId : "";
          const appSecret = typeof larkPayload.appSecret === "string" ? larkPayload.appSecret : "";
          if (!appId || !appSecret) {
            throw new Error("Lark app credentials not configured");
          }
          const result = await addLarkReaction({
            appId,
            appSecret,
            messageId,
            emoji,
          });
          return { platform: resolved.platform, ...result };
        }

        throw new Error(`Unsupported platform: ${resolved.platform}`);
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Failed to add reaction",
        resolveStatus: (message) => {
          if (message === "channelId is required") return 400;
          if (message === "messageId is required") return 400;
          if (message === "emoji is required") return 400;
          if (message === "Channel not found in configured workspaces") return 404;
          if (message.includes("not configured")) return 400;
          if (message.startsWith("emoji must be one of")) return 400;
          return 500;
        },
      },
    );
  });
}
