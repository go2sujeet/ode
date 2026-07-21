import type { Elysia } from "elysia";
import { uploadDiscordFile, uploadLarkFile, uploadSlackFile, createComment, parseRepoFullName } from "@/ims";
import { getGitHubWorkspaces, getGitHubTargetRepos } from "@/config";
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

export function registerSendRoutes(app: Elysia): void {
  /**
   * Unified file upload endpoint powering `ode send file`. Callers don't need
   * to know which messaging provider is behind the channel; the server
   * resolves the platform from the channel's configured workspace and calls
   * the matching SDK helper directly.
   */
  app.post("/api/send/file", async ({ request }: { request: Request }) => {
    return runRoute(
      async () => {
        const body = await readJsonBody(request);
        const channelIdRaw = getString(body, "channelId");
        if (!channelIdRaw) {
          throw new Error("channelId is required");
        }
        const filePath = getString(body, "filePath");
        if (!filePath) {
          throw new Error("filePath is required");
        }

        const resolved = resolveChannelLocator(channelIdRaw);
        const threadId = getOptionalString(body, "threadId");
        const filename = getOptionalString(body, "filename");
        const title = getOptionalString(body, "title");
        const initialComment = getOptionalString(body, "initialComment");

        if (resolved.platform === "slack") {
          const result = await uploadSlackFile({
            channelId: resolved.channelId,
            threadId,
            filePath,
            filename,
            title,
            initialComment,
          });
          return { platform: resolved.platform, result };
        }

        if (resolved.platform === "discord") {
          const discordPayload: Record<string, unknown> = { channelId: resolved.channelId };
          attachDiscordBotToken(discordPayload);
          const botToken = typeof discordPayload.botToken === "string" ? discordPayload.botToken : "";
          if (!botToken) {
            throw new Error("Discord bot token not configured");
          }
          const result = await uploadDiscordFile({
            botToken,
            channelId: resolved.channelId,
            filePath,
            filename,
            initialComment,
          });
          return { platform: resolved.platform, result };
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
          const result = await uploadLarkFile({
            appId,
            appSecret,
            channelId: resolved.channelId,
            threadId,
            filePath,
            filename,
            initialComment,
          });
          return { platform: resolved.platform, result };
        }

        throw new Error(`Unsupported platform: ${resolved.platform}`);
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Failed to upload file",
        resolveStatus: (message) => {
          if (message === "channelId is required") return 400;
          if (message === "filePath is required") return 400;
          if (message === "Channel not found in configured workspaces") return 404;
          if (message.includes("not configured")) return 400;
          if (message.startsWith("File not found")) return 400;
          return 500;
        },
      },
    );
  });

  app.post("/api/send/github-comment", async ({ request }: { request: Request }) => {
    return runRoute(
      async () => {
        const body = await readJsonBody(request);
        const repo = getString(body, "repo");
        const issueNumber = typeof body.issueNumber === "number" ? body.issueNumber : parseInt(getString(body, "issueNumber"), 10);
        const messageBody = getString(body, "body");
        if (!repo) throw new Error("repo is required (owner/repo)");
        if (!Number.isFinite(issueNumber)) throw new Error("issueNumber is required");
        if (!messageBody) throw new Error("body is required");

        const { owner, repo: repoName } = parseRepoFullName(repo);
        if (!owner || !repoName) throw new Error(`Invalid repo format: ${repo}`);

        const repoKey = `${owner}/${repoName}`;
        const ws = getGitHubWorkspaces().find((w) => {
          const repos = getGitHubTargetRepos();
          return repos?.includes(repoKey);
        });
        if (!ws) throw new Error(`No GitHub workspace configured for ${repoKey}`);

        const commentId = await createComment({ token: ws.token, owner, repo: repoName, issueNumber, body: messageBody });
        return { commentId };
      },
      (result) => jsonResponse(200, { ok: true, result }),
      {
        fallbackMessage: "Failed to post GitHub comment",
        resolveStatus: (m) => {
          if (m.startsWith("repo is required") || m.startsWith("issueNumber is required") || m.startsWith("body is required")) return 400;
          if (m.startsWith("Invalid repo format") || m.startsWith("No GitHub workspace configured")) return 400;
          return 500;
        },
      },
    );
  });
}
