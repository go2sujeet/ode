import { getWebHost, getWebPort } from "@/config";
import { log } from "@/utils";
import { createWebApp } from "./app";
import { hasWebUiBuild } from "./static-assets";

let webServer: { stop: () => void } | null = null;

export { hasWebUiBuild } from "./static-assets";

export function startLocalWebServer(): void {
  if (webServer) return;
  if (!hasWebUiBuild()) {
    log.info("Web UI build not found; serving API only");
  }

  const host = getWebHost();
  const port = getWebPort();
  const app = createWebApp();
  webServer = app.listen({
    hostname: host,
    port,
    idleTimeout: 30,
  });

  log.debug("Web UI server started", { host, port });
}

export function stopLocalWebServer(): void {
  if (!webServer) return;
  webServer.stop();
  webServer = null;
  log.debug("Web UI server stopped");
}
