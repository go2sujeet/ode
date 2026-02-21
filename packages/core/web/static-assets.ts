import { existsSync } from "fs";
import { join, resolve, sep } from "path";

let EMBEDDED_ASSETS: Record<string, string> = {};
let HAS_EMBEDDED_ASSETS = false;

try {
  const embedded = await import("./embedded-assets");
  EMBEDDED_ASSETS = embedded.EMBEDDED_ASSETS;
  HAS_EMBEDDED_ASSETS = embedded.HAS_EMBEDDED_ASSETS;
} catch {
  EMBEDDED_ASSETS = {};
  HAS_EMBEDDED_ASSETS = false;
}

const DEFAULT_WEB_BUILD_DIR = join(process.cwd(), "packages", "web-ui", "build");

function normalizePath(pathname: string): string {
  if (!pathname.startsWith("/")) return `/${pathname}`;
  return pathname;
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

function resolveFilePath(buildDir: string, pathname: string): string | null {
  const normalized = normalizePath(pathname).replace(/\0/g, "");
  const resolved = resolve(buildDir, `.${normalized}`);
  if (!resolved.startsWith(`${buildDir}${sep}`) && resolved !== buildDir) {
    return null;
  }
  return resolved;
}

export function getWebBuildDir(): string {
  const envDir = process.env.ODE_WEB_BUILD_DIR?.trim();
  if (envDir) return envDir;
  return DEFAULT_WEB_BUILD_DIR;
}

export function getContentType(pathname: string): string {
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

export function hasWebUiBuild(): boolean {
  return HAS_EMBEDDED_ASSETS || existsSync(getWebBuildDir());
}

export async function serveStaticAsset(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

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
