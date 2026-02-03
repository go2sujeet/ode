import {
  createSlackApp,
  setupMessageHandlers,
  setupInteractiveHandlers,
  startSlackApiServer,
  stopSlackApiServer,
  stopOAuthServer,
  recoverPendingRequests,
  initializeWorkspaceAuth,
  clearSlackAuthState,
  resetSlackState,
} from "./slack";
import { spawn, type ChildProcess } from "child_process";
import { watchFile, unwatchFile } from "fs";
import { stopServer } from "./agents";
import {
  getDefaultCwd,
  isLocalMode,
  getSlackAppToken,
  loadOdeConfig,
  invalidateOdeConfigCache,
  ODE_CONFIG_FILE,
} from "./config";
import { log } from "./logger";

const DEFAULT_WEB_HOST = "127.0.0.1";
const DEFAULT_WEB_PORT = 9293;
const CONFIG_WATCH_INTERVAL_MS = 1000;
const CONFIG_WATCH_DEBOUNCE_MS = 500;

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getLocalSettingsUrl(): string {
  const host = process.env.ODE_WEB_HOST?.trim() || DEFAULT_WEB_HOST;
  const port = parsePort(process.env.ODE_WEB_PORT?.trim(), DEFAULT_WEB_PORT);
  return `http://${host}:${port}/local-setting`;
}

let webDevServer: ChildProcess | null = null;
let slackApp: Awaited<ReturnType<typeof createSlackApp>> | null = null;
let slackAppToken: string | null = null;
let slackStarting = false;
let stopConfigWatcher: (() => void) | null = null;

function getLocalSlackAppToken(): string | null {
  try {
    const token = getSlackAppToken().trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

async function stopSlackRuntime(reason: string): Promise<void> {
  if (slackApp) {
    try {
      await slackApp.stop();
    } catch (error) {
      log.error("Failed to stop Slack app", { reason, error: String(error) });
    }
  }

  stopSlackApiServer();
  slackApp = null;
  slackAppToken = null;
  resetSlackState();
  log.info("Slack connection stopped", { reason });
}

async function startSlackRuntime(reason: string): Promise<void> {
  if (slackStarting || slackApp) return;

  if (isLocalMode()) {
    const token = getLocalSlackAppToken();
    if (!token) {
      log.warn("Slack app token missing", { mode: "local" });
      return;
    }
    slackAppToken = token;
  }

  slackStarting = true;
  try {
    clearSlackAuthState();
    await initializeWorkspaceAuth();
    const app = await createSlackApp();
    setupMessageHandlers();
    setupInteractiveHandlers();
    startSlackApiServer();
    await app.start();
    slackApp = app;
    log.info("Slack connection ready", { reason });
  } catch (error) {
    log.warn("Slack connection failed", { reason, error: String(error) });
    await stopSlackRuntime("startup failed");
  } finally {
    slackStarting = false;
  }
}

async function refreshSlackRuntime(reason: string): Promise<void> {
  if (!isLocalMode()) return;
  invalidateOdeConfigCache();
  loadOdeConfig();

  const nextToken = getLocalSlackAppToken();
  if (!nextToken) {
    await stopSlackRuntime("missing app token");
    return;
  }

  if (!slackApp) {
    await startSlackRuntime(reason);
    return;
  }

  if (slackAppToken && slackAppToken !== nextToken) {
    await stopSlackRuntime("app token changed");
    await startSlackRuntime(reason);
    return;
  }

  clearSlackAuthState();
  await initializeWorkspaceAuth();
  log.info("Slack auth refreshed", { reason });
}

function startLocalConfigWatcher(): void {
  if (!isLocalMode()) return;
  if (stopConfigWatcher) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  watchFile(ODE_CONFIG_FILE, { interval: CONFIG_WATCH_INTERVAL_MS }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void refreshSlackRuntime("config change");
    }, CONFIG_WATCH_DEBOUNCE_MS);
  });

  stopConfigWatcher = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    unwatchFile(ODE_CONFIG_FILE);
    stopConfigWatcher = null;
  };
}

function startWebDevServer(): void {
  if (webDevServer) return;
  const args = ["--cwd", "web", "dev"];
  webDevServer = spawn("bun", args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ODE_WEB_HOST: process.env.ODE_WEB_HOST || DEFAULT_WEB_HOST,
      ODE_WEB_PORT: process.env.ODE_WEB_PORT || String(DEFAULT_WEB_PORT),
    },
  });
  webDevServer.on("exit", (code, signal) => {
    log.info("Web UI server stopped", { code, signal });
    webDevServer = null;
  });
  webDevServer.on("error", (error) => {
    log.error("Failed to start web UI server", { error: String(error) });
  });
}

async function main(): Promise<void> {
  log.info("Starting Ode...");

  let defaultCwd: string | null = null;
  try {
    defaultCwd = getDefaultCwd();
  } catch {
    defaultCwd = null;
  }
  log.info("Config loaded", { defaultCwd, mode: isLocalMode() ? "local" : "cloud" });

  loadOdeConfig();

  if (isLocalMode()) {
    startWebDevServer();
    startLocalConfigWatcher();
  }

  await startSlackRuntime("startup");

  if (slackApp) {
    log.info("Slack app created");
    log.info("Message handlers registered");
    log.info("Interactive handlers registered");
  }

  // Handle shutdown gracefully
  const shutdown = async (signal: string) => {
    log.info("Shutting down...", { signal });

    try {
      stopOAuthServer();
      await stopSlackRuntime("shutdown");
      if (webDevServer) {
        webDevServer.kill();
        webDevServer = null;
      }
      if (stopConfigWatcher) {
        stopConfigWatcher();
      }
      await stopServer();
      log.info("Cleanup complete");
      process.exit(0);
    } catch (err) {
      log.error("Error during cleanup", { error: String(err) });
      process.exit(1);
    }
  };

  let restartScheduled = false;
  const scheduleRestart = (signal: string) => {
    if (restartScheduled) return;
    restartScheduled = true;

    const delayMs = 3000;
    log.info("Restart signal received", { signal, delayMs });

    setTimeout(async () => {
      log.info("Restarting Ode process", { delayMs });
      const child = spawn("bash", ["/root/ode/restart.sh"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      await shutdown("restart");
    }, delayMs);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGUSR2", () => scheduleRestart("SIGUSR2"));

  if (slackApp) {
    // Give socket connection time to fully establish before recovery
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Recover any interrupted requests from previous run
    await recoverPendingRequests();

    log.info("Bot is running in Socket Mode");
  }

  log.info("Configure Ode settings at", { url: getLocalSettingsUrl() });
  log.info("Ode is ready! Waiting for messages...");
}

main().catch((err) => {
  log.error("Fatal error", { error: String(err) });
  process.exit(1);
});
