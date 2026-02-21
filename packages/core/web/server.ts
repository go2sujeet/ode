import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { EMBEDDED_ASSETS, HAS_EMBEDDED_ASSETS } from "./embedded-assets";
import {
  discoverDiscordWorkspace,
  discoverLarkWorkspace,
  discoverSlackWorkspace,
  readLocalSettings,
  syncDiscordWorkspace,
  syncLarkWorkspace,
  syncSlackWorkspace,
  writeLocalSettings,
} from "./local-settings";
import {
  defaultDashboardConfig,
  sanitizeDashboardConfig,
  getWebHost,
  getWebPort,
  getDiscordBotTokens,
  getLarkAppCredentials,
  getWorkspaces,
} from "@/config";
import { getAnyServerUrl, startServer as startOpenCodeServer } from "@/agents/opencode";
import {
  getAllSessions,
  getHarnessRunEventsAsSession,
  getHarnessRunMetaAsSession,
  getHarnessRunsAsSessions,
  getSessionEvents,
  getSessionMeta,
  type SessionEvent,
} from "@/config/local/redis";
import { handleDiscordActionPayload, handleLarkActionPayload, handleLarkEventPayload, handleSlackActionPayload } from "@/ims";
import { log } from "@/utils";

const DEFAULT_WEB_BUILD_DIR = join(process.cwd(), "packages", "web-ui", "build");
const DEFAULT_SESSION_EVENTS_LIMIT = 2000;
const MAX_SESSION_EVENTS_LIMIT = 10000;

let webServer: ReturnType<typeof Bun.serve> | null = null;

type JsonResponse = {
  ok: boolean;
  error?: string;
  config?: typeof defaultDashboardConfig;
  workspace?: (typeof defaultDashboardConfig)["workspaces"][number];
  agentCheck?: {
    opencode: boolean;
    claude: boolean;
    codex: boolean;
    kimi: boolean;
    kiro: boolean;
    kilo: boolean;
    qwen: boolean;
    goose: boolean;
    gemini: boolean;
  };
  providers?: unknown;
  result?: unknown;
};

function getDiscordWorkspaceTokenByChannel(channelId: string): string | undefined {
  if (!channelId) return undefined;
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "discord") continue;
    const token = workspace.discordBotToken?.trim();
    if (!token) continue;
    if (workspace.channelDetails.some((channel) => channel.id === channelId)) {
      return token;
    }
  }
  return undefined;
}

function getDiscordWorkspaceTokenByGuild(guildId: string): string | undefined {
  if (!guildId) return undefined;
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "discord") continue;
    const token = workspace.discordBotToken?.trim();
    if (!token) continue;
    if (workspace.id === guildId) {
      return token;
    }
  }
  return undefined;
}

function resolveDiscordBotTokenFromConfig(payload: Record<string, unknown>): string | undefined {
  const channelId = typeof payload.channelId === "string" ? payload.channelId.trim() : "";
  if (channelId) {
    const channelToken = getDiscordWorkspaceTokenByChannel(channelId);
    if (channelToken) return channelToken;
  }

  const guildId = typeof payload.guildId === "string" ? payload.guildId.trim() : "";
  if (guildId) {
    const guildToken = getDiscordWorkspaceTokenByGuild(guildId);
    if (guildToken) return guildToken;
  }

  for (const entry of getDiscordBotTokens()) {
    const token = entry.token?.trim();
    if (token) return token;
  }

  return undefined;
}

function attachDiscordBotToken(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  const existing = typeof record.botToken === "string" ? record.botToken.trim() : "";
  if (existing) {
    record.botToken = existing;
    return;
  }
  const resolved = resolveDiscordBotTokenFromConfig(record);
  if (resolved) {
    record.botToken = resolved;
  }
}

function getLarkWorkspaceCredentialsByChannel(channelId: string): { appId: string; appSecret: string } | undefined {
  if (!channelId) return undefined;
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "lark") continue;
    const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim();
    const appSecret = workspace.larkAppSecret?.trim();
    if (!appId || !appSecret) continue;
    if (workspace.channelDetails.some((channel) => channel.id === channelId)) {
      return { appId, appSecret };
    }
  }
  return undefined;
}

function getLarkWorkspaceCredentialsByWorkspace(workspaceId: string): { appId: string; appSecret: string } | undefined {
  if (!workspaceId) return undefined;
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "lark") continue;
    const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim();
    const appSecret = workspace.larkAppSecret?.trim();
    if (!appId || !appSecret) continue;
    if (workspace.id === workspaceId) {
      return { appId, appSecret };
    }
  }
  return undefined;
}

function attachLarkCredentials(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  const existingAppId = typeof record.appId === "string" ? record.appId.trim() : "";
  const existingAppSecret = typeof record.appSecret === "string" ? record.appSecret.trim() : "";
  if (existingAppId && existingAppSecret) {
    record.appId = existingAppId;
    record.appSecret = existingAppSecret;
    return;
  }

  const channelId = typeof record.channelId === "string" ? record.channelId.trim() : "";
  if (channelId) {
    const byChannel = getLarkWorkspaceCredentialsByChannel(channelId);
    if (byChannel) {
      record.appId = byChannel.appId;
      record.appSecret = byChannel.appSecret;
      return;
    }
  }

  const workspaceId = typeof record.workspaceId === "string" ? record.workspaceId.trim() : "";
  if (workspaceId) {
    const byWorkspace = getLarkWorkspaceCredentialsByWorkspace(workspaceId);
    if (byWorkspace) {
      record.appId = byWorkspace.appId;
      record.appSecret = byWorkspace.appSecret;
      return;
    }
  }

  const first = getLarkAppCredentials()[0];
  if (first) {
    record.appId = first.appId;
    record.appSecret = first.appSecret;
  }
}

function extractProviderModelIds(providerId: string, models: unknown): string[] {
  if (Array.isArray(models)) {
    return models
      .map((entry) => {
        if (typeof entry === "string") return `${providerId}/${entry}`;
        if (!entry || typeof entry !== "object") return "";
        const model = entry as Record<string, unknown>;
        const modelId =
          (typeof model.id === "string" && model.id)
          || (typeof model.modelID === "string" && model.modelID)
          || (typeof model.modelId === "string" && model.modelId)
          || "";
        return modelId ? `${providerId}/${modelId}` : "";
      })
      .filter(Boolean);
  }

  if (models && typeof models === "object") {
    const record = models as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return extractProviderModelIds(providerId, record.items);
    }
    return Object.entries(record)
      .map(([key, value]) => {
        if (typeof value === "string") return `${providerId}/${value}`;
        if (value && typeof value === "object") {
          const model = value as Record<string, unknown>;
          const modelId =
            (typeof model.id === "string" && model.id)
            || (typeof model.modelID === "string" && model.modelID)
            || (typeof model.modelId === "string" && model.modelId)
            || key;
          return modelId ? `${providerId}/${modelId}` : "";
        }
        return key ? `${providerId}/${key}` : "";
      })
      .filter(Boolean);
  }

  return [];
}

function extractOpenCodeModels(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const providersRaw = Object.prototype.hasOwnProperty.call(data, "providers") ? data.providers : data;
  const models = new Set<string>();

  if (Array.isArray(providersRaw)) {
    for (const entry of providersRaw) {
      if (!entry || typeof entry !== "object") continue;
      const provider = entry as Record<string, unknown>;
      const providerId =
        (typeof provider.id === "string" && provider.id)
        || (typeof provider.providerID === "string" && provider.providerID)
        || (typeof provider.providerId === "string" && provider.providerId)
        || "";
      if (!providerId) continue;
      for (const model of extractProviderModelIds(providerId, provider.models)) {
        models.add(model);
      }
    }
  } else if (providersRaw && typeof providersRaw === "object") {
    for (const [providerId, providerValue] of Object.entries(providersRaw as Record<string, unknown>)) {
      if (!providerValue || typeof providerValue !== "object") continue;
      const provider = providerValue as Record<string, unknown>;
      for (const model of extractProviderModelIds(providerId, provider.models)) {
        models.add(model);
      }
    }
  }

  return Array.from(models).sort();
}

async function fetchKiloModels(): Promise<string[]> {
  const child = Bun.spawn({
    cmd: ["kilo", "models"],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    const details = stderr.trim() || stdout.trim() || "Unknown error";
    throw new Error(details);
  }
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function parsePositiveInt(value: string | null, fallback: number, max?: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const intValue = Math.floor(parsed);
  if (typeof max === "number") return Math.min(intValue, max);
  return intValue;
}

function jsonResponse(status: number, payload: JsonResponse): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function validateWorkspaceConfig(config: typeof defaultDashboardConfig): string | null {
  const idCounts = new Map<string, number>();
  const slackBotTokenCounts = new Map<string, number>();
  const discordBotTokenCounts = new Map<string, number>();
  const larkAppKeyCounts = new Map<string, number>();
  for (const workspace of config.workspaces) {
    const workspaceId = workspace.id.trim();
    if (!workspaceId) {
      return "Workspace id is required for every workspace";
    }
    idCounts.set(workspaceId, (idCounts.get(workspaceId) ?? 0) + 1);
    if (workspace.type === "discord") {
      const botToken = workspace.discordBotToken?.trim() ?? "";
      if (!botToken) {
        const label = workspace.name.trim() || workspace.id;
        return `Missing Discord bot token for workspace: ${label}`;
      }
      discordBotTokenCounts.set(botToken, (discordBotTokenCounts.get(botToken) ?? 0) + 1);
      continue;
    }

    if (workspace.type === "lark") {
      const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim() || "";
      const appSecret = workspace.larkAppSecret?.trim() ?? "";
      if (!appId || !appSecret) {
        const label = workspace.name.trim() || workspace.id;
        return `Missing Lark app key/app secret for workspace: ${label}`;
      }
      larkAppKeyCounts.set(appId, (larkAppKeyCounts.get(appId) ?? 0) + 1);
      continue;
    }

    const appToken = workspace.slackAppToken?.trim() ?? "";
    const botToken = workspace.slackBotToken?.trim() ?? "";
    if (!appToken || !botToken) {
      const label = workspace.name.trim() || workspace.id;
      return `Missing Slack app/bot token for workspace: ${label}`;
    }
    slackBotTokenCounts.set(botToken, (slackBotTokenCounts.get(botToken) ?? 0) + 1);
  }

  const duplicateIds = Array.from(idCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicateIds.length > 0) {
    return `Duplicate workspace ids: ${duplicateIds.join(", ")}`;
  }

  const duplicateSlackBotTokenCount = Array.from(slackBotTokenCounts.values()).filter((count) => count > 1).length;
  if (duplicateSlackBotTokenCount > 0) {
    return "Duplicate Slack bot tokens found across workspaces";
  }

  const duplicateDiscordBotTokenCount = Array.from(discordBotTokenCounts.values()).filter((count) => count > 1).length;
  if (duplicateDiscordBotTokenCount > 0) {
    return "Duplicate Discord bot tokens found across workspaces";
  }

  const duplicateLarkAppKeyCount = Array.from(larkAppKeyCounts.values()).filter((count) => count > 1).length;
  if (duplicateLarkAppKeyCount > 0) {
    return "Duplicate Lark app keys found across workspaces";
  }

  return null;
}

function resolveAssetPath(pathname: string): string {
  const appAssetIndex = pathname.indexOf("/_app/");
  if (appAssetIndex >= 0) {
    return pathname.slice(appAssetIndex);
  }
  if (pathname === "/") return "/index.html";
  if (pathname.endsWith("/")) return `${pathname.slice(0, -1)}.html`;
  return pathname;
}

function getWebBuildDir(): string {
  const envDir = process.env.ODE_WEB_BUILD_DIR?.trim();
  if (envDir) return envDir;
  return DEFAULT_WEB_BUILD_DIR;
}

function normalizePath(pathname: string): string {
  if (!pathname.startsWith("/")) return `/${pathname}`;
  return pathname;
}

function resolveFilePath(buildDir: string, pathname: string): string | null {
  const normalized = normalizePath(pathname).replace(/\0/g, "");
  const resolved = resolve(buildDir, `.${normalized}`);
  if (!resolved.startsWith(`${buildDir}${sep}`) && resolved !== buildDir) {
    return null;
  }
  return resolved;
}

function getEmbeddedAsset(pathname: string, request: Request): Response | null {
  if (!HAS_EMBEDDED_ASSETS) return null;

  const resolvedPath = resolveAssetPath(pathname);
  const assetPath = normalizePath(resolvedPath);
  let data = EMBEDDED_ASSETS[assetPath];

  if (!data) {
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      data = EMBEDDED_ASSETS["/index.html"];
      if (!data) return null;
      return new Response(Buffer.from(data, "base64"), {
        status: 200,
        headers: { "content-type": getContentType("/index.html") },
      });
    }
    return null;
  }

  return new Response(Buffer.from(data, "base64"), {
    status: 200,
    headers: { "content-type": getContentType(assetPath) },
  });
}

function getContentType(pathname: string): string {
  const lower = pathname.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
  if (lower.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function collapseTextDeltas(events: SessionEvent[]): SessionEvent[] {
  const result: SessionEvent[] = [];
  const textPartIndices = new Map<string, number>();

  for (const event of events) {
    const eventType = event.type || (event.data as any)?.type;
    const props = (event.data?.properties || event.data) as Record<string, unknown> | undefined;
    const part = props?.part as Record<string, unknown> | undefined;

    if (eventType === "message.part.updated" && part?.type === "text") {
      const partId = part.id as string;
      if (!partId) {
        result.push(event);
        continue;
      }

      const existingIdx = textPartIndices.get(partId);
      if (existingIdx !== undefined) {
        result[existingIdx] = event;
      } else {
        textPartIndices.set(partId, result.length);
        result.push(event);
      }
      continue;
    }

    result.push(event);
  }

  return result;
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/local-setting") {
    return new Response(null, {
      status: 307,
      headers: { location: "/" },
    });
  }

  if (pathname.startsWith("/local-setting/")) {
    const target = pathname.slice("/local-setting".length) || "/";
    return new Response(null, {
      status: 307,
      headers: { location: target },
    });
  }

  if (pathname === "/api/config") {
    if (request.method === "GET") {
      const config = await readLocalSettings();
      return jsonResponse(200, { ok: true, config });
    }
    if (request.method === "PUT") {
      try {
        const payload = await request.json();
        const sanitized = sanitizeDashboardConfig(payload);
        const validationError = validateWorkspaceConfig(sanitized);
        if (validationError) {
          return jsonResponse(400, { ok: false, error: validationError });
        }
        await writeLocalSettings(sanitized);
        return jsonResponse(200, { ok: true, config: sanitized });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid payload";
        return jsonResponse(400, { ok: false, error: message });
      }
    }
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  if (pathname.startsWith("/api/sessions")) {
    if (request.method !== "GET") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }

    try {
      if (pathname === "/api/sessions") {
        const [sessions, harnessSessions] = await Promise.all([
          getAllSessions(),
          getHarnessRunsAsSessions(),
        ]);
        const merged = [...sessions, ...harnessSessions]
          .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
          .filter((session, index, all) => all.findIndex((item) => item.sessionId === session.sessionId) === index);
        return jsonResponse(200, { ok: true, result: merged });
      }

      const eventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
      if (eventsMatch) {
        const sessionId = eventsMatch[1];
        if (!sessionId) {
          return jsonResponse(400, { ok: false, error: "Missing session id" });
        }
        const url = new URL(request.url);
        const expand = url.searchParams.get("expand") === "true";
        const since = url.searchParams.get("since");
        const sinceTs = since ? parseInt(since, 10) : null;
        const hasValidSince = sinceTs !== null && !Number.isNaN(sinceTs);
        const limit = parsePositiveInt(
          url.searchParams.get("limit"),
          DEFAULT_SESSION_EVENTS_LIMIT,
          MAX_SESSION_EVENTS_LIMIT
        );
        let events = await getSessionEvents(sessionId, {
          since: hasValidSince ? sinceTs : undefined,
          limit: hasValidSince ? undefined : limit,
        });
        if (events.length === 0) {
          events = await getHarnessRunEventsAsSession(sessionId, {
            since: hasValidSince ? sinceTs : undefined,
            limit: hasValidSince ? undefined : limit,
          });
        }

        let result: SessionEvent[];
        if (expand) {
          result = hasValidSince
            ? events.filter((event) => event.timestamp > sinceTs)
            : events;
        } else {
          const collapsed = collapseTextDeltas(events);
          result = hasValidSince
            ? collapsed.filter((event) => event.timestamp > sinceTs)
            : collapsed;
        }

        return jsonResponse(200, { ok: true, result });
      }

      const metaMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (metaMatch) {
        const sessionId = metaMatch[1];
        if (!sessionId) {
          return jsonResponse(400, { ok: false, error: "Missing session id" });
        }
        let meta = await getSessionMeta(sessionId);
        if (!meta) {
          meta = await getHarnessRunMetaAsSession(sessionId);
        }
        if (!meta) {
          return jsonResponse(404, { ok: false, error: "Session not found" });
        }
        return jsonResponse(200, { ok: true, result: meta });
      }

      return jsonResponse(404, { ok: false, error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      return jsonResponse(500, { ok: false, error: message });
    }
  }

  if (pathname === "/api/slack-sync") {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : "";
      if (!workspaceId) {
        return jsonResponse(400, { ok: false, error: "Missing workspaceId" });
      }
      const workspace = await syncSlackWorkspace(workspaceId);
      return jsonResponse(200, { ok: true, workspace });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slack sync failed";
      return jsonResponse(500, { ok: false, error: message });
    }
  }

  if (pathname === "/api/discord-sync") {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : "";
      if (!workspaceId) {
        return jsonResponse(400, { ok: false, error: "Missing workspaceId" });
      }
      const workspace = await syncDiscordWorkspace(workspaceId);
      return jsonResponse(200, { ok: true, workspace });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discord sync failed";
      return jsonResponse(500, { ok: false, error: message });
    }
  }

  if (pathname === "/api/slack-discover") {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      const slackAppToken = typeof payload.slackAppToken === "string" ? payload.slackAppToken : "";
      const slackBotToken = typeof payload.slackBotToken === "string" ? payload.slackBotToken : "";
      const workspace = await discoverSlackWorkspace(slackAppToken, slackBotToken);
      return jsonResponse(200, { ok: true, workspace });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slack workspace discovery failed";
      const status = message.startsWith("Missing Slack") ? 400 : 500;
      return jsonResponse(status, { ok: false, error: message });
    }
  }

  if (pathname === "/api/discord-discover") {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      const discordBotToken = typeof payload.discordBotToken === "string" ? payload.discordBotToken : "";
      const workspace = await discoverDiscordWorkspace(discordBotToken);
      return jsonResponse(200, { ok: true, workspace });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discord workspace discovery failed";
      const status = message.startsWith("Missing Discord") ? 400 : 500;
      return jsonResponse(status, { ok: false, error: message });
    }
  }

  if (pathname === "/api/lark-discover") {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      const larkAppKey = typeof payload.larkAppKey === "string"
        ? payload.larkAppKey
        : (typeof payload.larkAppId === "string" ? payload.larkAppId : "");
      const larkAppSecret = typeof payload.larkAppSecret === "string" ? payload.larkAppSecret : "";
      const workspace = await discoverLarkWorkspace(larkAppKey, larkAppSecret);
      return jsonResponse(200, { ok: true, workspace });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lark workspace discovery failed";
      const status = message.startsWith("Missing Lark") ? 400 : 500;
      return jsonResponse(status, { ok: false, error: message });
    }
  }

  if (pathname === "/api/lark-sync") {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    try {
      const payload = (await request.json()) as Record<string, unknown>;
      const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : "";
      if (!workspaceId) {
        return jsonResponse(400, { ok: false, error: "Missing workspaceId" });
      }
      const workspace = await syncLarkWorkspace(workspaceId);
      return jsonResponse(200, { ok: true, workspace });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lark sync failed";
      return jsonResponse(500, { ok: false, error: message });
    }
  }

  if (pathname === "/api/lark/event" || pathname === "/api/lark-event") {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    try {
      const payload = await request.json();
      const response = await handleLarkEventPayload(payload);
      return jsonResponse(response.status, response.body as JsonResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lark event handling failed";
      return jsonResponse(500, { ok: false, error: message });
    }
  }

  if (pathname === "/api/agent-check") {
    if (request.method !== "GET") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    const opencodeAvailable = Boolean(Bun.which("opencode"));
    let opencodeModels: string[] = [];
    let opencodeModelError: string | undefined;
    const kiloAvailable = Boolean(Bun.which("kilo"));
    let kiloModels: string[] = [];
    let kiloModelError: string | undefined;

    if (opencodeAvailable) {
      try {
        await startOpenCodeServer();
        const baseUrl = await getAnyServerUrl();
        const providersUrl = new URL("/config/providers", baseUrl).toString();
        const response = await fetch(providersUrl);
        if (!response.ok) {
          throw new Error(`providers endpoint returned ${response.status}`);
        }
        const payload = await response.json();
        opencodeModels = extractOpenCodeModels(payload);
      } catch (error) {
        opencodeModelError = error instanceof Error ? error.message : String(error);
        log.warn("Failed to query OpenCode models during agent check", {
          error: opencodeModelError,
        });
      }
    }

    if (kiloAvailable) {
      try {
        kiloModels = await fetchKiloModels();
      } catch (error) {
        kiloModelError = error instanceof Error ? error.message : String(error);
        log.warn("Failed to query Kilo models during agent check", {
          error: kiloModelError,
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      result: {
        opencode: opencodeAvailable,
        claude: Boolean(Bun.which("claude")),
        codex: Boolean(Bun.which("codex")),
        kimi: Boolean(Bun.which("kimi")),
        kiro: Boolean(Bun.which("kiro-cli") || Bun.which("kiro")),
        kilo: kiloAvailable,
        qwen: Boolean(Bun.which("qwen") || Bun.which("qwen-code")),
        goose: Boolean(Bun.which("goose")),
        gemini: Boolean(Bun.which("gemini")),
        opencodeModels,
        opencodeModelError,
        kiloModels,
        kiloModelError,
      },
    });
  }

  if (pathname === "/api/action") {
    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse(400, { ok: false, error: "Invalid JSON payload" });
    }

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
    return jsonResponse(response.ok ? 200 : 400, response);
  }

  const embedded = getEmbeddedAsset(pathname, request);
  if (embedded) return embedded;

  const buildDir = getWebBuildDir();
  if (!existsSync(buildDir)) {
    return new Response("Web UI build not found", { status: 404 });
  }

  const resolvedPath = resolveAssetPath(pathname);
  let filePath = resolveFilePath(buildDir, resolvedPath);
  if (!filePath) return new Response("Not found", { status: 404 });

  let file = Bun.file(filePath);
  if (!(await file.exists())) {
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      filePath = resolveFilePath(buildDir, "/index.html");
      if (!filePath) return new Response("Not found", { status: 404 });
      file = Bun.file(filePath);
    }
  }

  if (!(await file.exists())) return new Response("Not found", { status: 404 });

  return new Response(file, {
    status: 200,
    headers: { "content-type": getContentType(filePath) },
  });
}

export function hasWebUiBuild(): boolean {
  return HAS_EMBEDDED_ASSETS || existsSync(getWebBuildDir());
}

export function startLocalWebServer(): void {
  if (webServer) return;
  if (!hasWebUiBuild()) {
    log.info("Web UI build not found; serving API only", { buildDir: getWebBuildDir() });
  }

  const host = getWebHost();
  const port = getWebPort();

  webServer = Bun.serve({
    hostname: host,
    port,
    idleTimeout: 30,
    fetch: handleRequest,
  });

  log.debug("Web UI server started", { host, port });
}

export function stopLocalWebServer(): void {
  if (!webServer) return;
  webServer.stop();
  webServer = null;
  log.debug("Web UI server stopped");
}
