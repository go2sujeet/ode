import { spawn, type ChildProcess } from "child_process";
import { createWriteStream, existsSync, renameSync, rmSync, statSync, type WriteStream } from "fs";
import { clearPendingUpgradeRestart, clearRuntimeReadyState } from "./control";
import { ensureDaemonDir, getDaemonLogPath } from "./paths";
import { isProcessAlive, patchDaemonState, readDaemonState } from "./state";
import { getActiveThreads } from "@/config/local/settings";

const RESTART_DELAY_MS = 3000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;
const IDLE_WINDOW_MS = 30 * 60 * 1000;
const LOG_MAX_BYTES = 5 * 1024 * 1024;

let runtimeChild: ChildProcess | null = null;
let restartingTimer: NodeJS.Timeout | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;
let logStream: WriteStream | null = null;

const cliEntry: string = process.argv[1] ?? new URL("../cli.ts", import.meta.url).pathname;
const bunExecutable: string = process.argv[0] ?? process.execPath;

function rotateLogsIfNeeded(): void {
  const logPath = getDaemonLogPath();
  try {
    const stats = statSync(logPath);
    if (stats.size < LOG_MAX_BYTES) return;
    const backup = `${logPath}.1`;
    if (existsSync(backup)) {
      rmSync(backup, { force: true });
    }
    renameSync(logPath, backup);
  } catch {
    // Ignore if file does not exist or can't rotate.
  }
}

function ensureLogStream(): WriteStream {
  if (logStream) return logStream;
  rotateLogsIfNeeded();
  logStream = createWriteStream(getDaemonLogPath(), { flags: "a" });
  return logStream;
}

function writeManagerLog(message: string): void {
  const line = `[${new Date().toISOString()}] [daemon] ${message}\n`;
  try {
    ensureLogStream().write(line);
  } catch {
    // Swallow logging errors; daemon should keep running.
  }
}

function acquireSingleton(): boolean {
  const snapshot = readDaemonState();
  if (snapshot.managerPid && snapshot.managerPid !== process.pid && isProcessAlive(snapshot.managerPid)) {
    return false;
  }
  patchDaemonState({ managerPid: process.pid, status: "starting" });
  return true;
}

function attachChildLogs(child: ChildProcess): void {
  child.stdout?.on("data", (chunk) => {
    try {
      ensureLogStream().write(chunk);
    } catch {
      // ignore
    }
  });
  child.stderr?.on("data", (chunk) => {
    try {
      ensureLogStream().write(chunk);
    } catch {
      // ignore
    }
  });
}

function startRuntime(reason: string): void {
  if (runtimeChild) return;
  clearRuntimeReadyState();
  writeManagerLog(`Starting runtime (${reason})`);
  const child = spawn(bunExecutable, [cliEntry, "__runtime"], {
    env: {
      ...process.env,
      ODE_DAEMONIZED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess;
  runtimeChild = child;
  patchDaemonState({
    runtimePid: child.pid ?? null,
    status: "starting",
    lastStartAt: Date.now(),
  });
  attachChildLogs(child);
  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => handleRuntimeExit(code, signal));
}

function handleRuntimeExit(code: number | null, signal: NodeJS.Signals | null): void {
  writeManagerLog(`Runtime exited (code=${code ?? "null"}, signal=${signal ?? "none"})`);
  runtimeChild = null;
  patchDaemonState({
    runtimePid: null,
    lastExitAt: Date.now(),
    lastExitCode: code ?? null,
    lastExitSignal: signal ?? null,
    status: shuttingDown ? "stopped" : "restarting",
  });
  if (shuttingDown) return;
  scheduleRestart("exit");
}

function scheduleRestart(reason: string): void {
  if (restartingTimer) return;
  restartingTimer = setTimeout(() => {
    restartingTimer = null;
    startRuntime(`restart (${reason})`);
  }, RESTART_DELAY_MS);
}

function restartRuntime(reason: string): void {
  if (!runtimeChild) {
    startRuntime(reason);
    return;
  }
  writeManagerLog(`Restart requested (${reason})`);
  const child = runtimeChild;
  const timeout = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }, 10000);
  child.once("exit", () => {
    clearTimeout(timeout);
    if (!shuttingDown) {
      startRuntime(reason);
    }
  });
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}

function hasRecentActivity(windowMs: number): boolean {
  try {
    const activeThreads = getActiveThreads();
    if (activeThreads.length === 0) return false;
    const latest = Math.max(...activeThreads.map((entry) => entry.lastActiveAt));
    if (!Number.isFinite(latest)) return false;
    return Date.now() - latest < windowMs;
  } catch {
    return true;
  }
}

function startIdleWatcher(): void {
  idleTimer = setInterval(() => {
    if (!runtimeChild) return;
    const state = readDaemonState();
    if (!state.pendingUpgradeRestart) return;
    if (hasRecentActivity(IDLE_WINDOW_MS)) return;
    writeManagerLog("Idle window detected; restarting to apply pending upgrade");
    clearPendingUpgradeRestart();
    restartRuntime("apply-upgrade");
  }, IDLE_CHECK_INTERVAL_MS);
}

function stopIdleWatcher(): void {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  writeManagerLog(`Shutting down daemon (${reason})`);
  if (restartingTimer) {
    clearTimeout(restartingTimer);
    restartingTimer = null;
  }
  stopIdleWatcher();
  await stopRuntimeChild();
  try {
    logStream?.end();
  } catch {
    // ignore
  }
  patchDaemonState({
    managerPid: null,
    runtimePid: null,
    status: "stopped",
  });
  process.exit(0);
}

function stopRuntimeChild(): Promise<void> {
  if (!runtimeChild) return Promise.resolve();
  const child = runtimeChild;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

function setupSignalHandlers(): void {
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("uncaughtException", (error) => {
    writeManagerLog(`Uncaught exception: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    writeManagerLog(`Unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
    void shutdown("unhandledRejection");
  });
}

export async function runDaemon(): Promise<void> {
  ensureDaemonDir();
  if (!acquireSingleton()) {
    // Existing daemon is running; nothing to do.
    return;
  }
  writeManagerLog("Daemon process initialized");
  startRuntime("initial");
  startIdleWatcher();
}
