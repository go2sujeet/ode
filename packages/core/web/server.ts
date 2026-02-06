import { existsSync } from "fs";
import { join, resolve, sep } from "path";
import { EMBEDDED_ASSETS, HAS_EMBEDDED_ASSETS } from "./embedded-assets";
import {
  readLocalSettings,
  syncSlackWorkspace,
  writeLocalSettings,
} from "./local-settings";
import {
  defaultDashboardConfig,
  sanitizeDashboardConfig,
  isLocalMode,
  getWebHost,
  getWebPort,
} from "@/config";
import { getAnyServerUrl, startServer as startOpenCodeServer } from "@/agents/opencode";
import {
  getAllSessions,
  getSessionEvents,
  getSessionMeta,
  type SessionEvent,
} from "@/config/local/redis";
import { handleSlackActionPayload } from "@/ims";
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
  };
  providers?: unknown;
  result?: unknown;
};

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

function parsePositiveInt(value: string | null, fallback: number, max?: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const intValue = Math.floor(parsed);
  if (typeof max === "number") return Math.min(intValue, max);
  return intValue;
}

function isRedisSessionApiEnabled(): boolean {
  if (!isLocalMode()) return false;
  const flag = process.env.ODE_REDIS_ENABLED?.trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

function jsonResponse(status: number, payload: JsonResponse): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function resolveAssetPath(pathname: string): string {
  const appAssetIndex = pathname.indexOf("/_app/");
  if (appAssetIndex >= 0) {
    return pathname.slice(appAssetIndex);
  }
  if (pathname === "/") return "/index.html";
  if (pathname === "/local-setting") return "/local-setting.html";
  if (pathname.startsWith("/local-setting/")) return "/local-setting.html";
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

  if (pathname === "/") {
    return new Response(null, {
      status: 307,
      headers: { location: "/local-setting" },
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
    if (!isRedisSessionApiEnabled()) {
      return jsonResponse(404, { ok: false, error: "Session inspector disabled" });
    }

    if (request.method !== "GET") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }

    try {
      if (pathname === "/api/sessions") {
        const sessions = await getAllSessions();
        return jsonResponse(200, { ok: true, result: sessions });
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
        const events = await getSessionEvents(sessionId, {
          since: hasValidSince ? sinceTs : undefined,
          limit: hasValidSince ? undefined : limit,
        });

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
        const meta = await getSessionMeta(sessionId);
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

  if (pathname === "/api/agent-check") {
    if (request.method !== "GET") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }
    const opencodeAvailable = Boolean(Bun.which("opencode"));
    let opencodeModels: string[] = [];
    let opencodeModelError: string | undefined;

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

    return jsonResponse(200, {
      ok: true,
      result: {
        opencode: opencodeAvailable,
        claude: Boolean(Bun.which("claude")),
        codex: Boolean(Bun.which("codex")),
        opencodeModels,
        opencodeModelError,
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

    const response = await handleSlackActionPayload(payload);
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

  log.info("Web UI server started", { host, port });
}

export function stopLocalWebServer(): void {
  if (!webServer) return;
  webServer.stop();
  webServer = null;
  log.info("Web UI server stopped");
}
