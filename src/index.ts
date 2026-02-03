import {
  createSlackApp,
  setupMessageHandlers,
  setupInteractiveHandlers,
  startSlackApiServer,
  stopSlackApiServer,
  stopOAuthServer,
  recoverPendingRequests,
  initializeWorkspaceAuth,
} from "./slack";
import { spawn, type ChildProcess } from "child_process";
import { stopServer } from "./agents";
import { getDefaultCwd, isLocalMode } from "./config";
import { log } from "./logger";

const DEFAULT_WEB_HOST = "127.0.0.1";
const DEFAULT_WEB_PORT = 9293;

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

  // Load workspace auth mappings (env + DB bot tokens)
  await initializeWorkspaceAuth();

  // Create Slack app (single Socket Mode connection)
  const app = await createSlackApp();
  log.info("Slack app created");

  // Setup handlers
  setupMessageHandlers();
  log.info("Message handlers registered");

  setupInteractiveHandlers();
  log.info("Interactive handlers registered");

  startSlackApiServer();
  if (isLocalMode()) {
    startWebDevServer();
  }

  // Handle shutdown gracefully
  const shutdown = async (signal: string) => {
    log.info("Shutting down...", { signal });

    try {
      stopOAuthServer();
      stopSlackApiServer();
      if (webDevServer) {
        webDevServer.kill();
        webDevServer = null;
      }
      await stopServer();
      await app.stop();
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

  // Start the app
  await app.start();
  log.info("Bot is running in Socket Mode");

  // Give socket connection time to fully establish before recovery
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Recover any interrupted requests from previous run
  await recoverPendingRequests();

  log.info("Configure Ode settings at", { url: getLocalSettingsUrl() });
  log.info("Ode is ready! Waiting for messages...");
}

main().catch((err) => {
  log.error("Fatal error", { error: String(err) });
  process.exit(1);
});
