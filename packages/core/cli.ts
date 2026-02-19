#!/usr/bin/env bun

import { spawn } from "child_process";
import { closeSync, openSync, readSync, statSync } from "fs";
import packageJson from "../../package.json" with { type: "json" };
import { getWebHost, getWebPort } from "@/config";
import { runDaemon } from "@/core/daemon/manager";
import { getDaemonLogPath } from "@/core/daemon/paths";
import { isProcessAlive, readDaemonState, type DaemonState } from "@/core/daemon/state";
import { runOnboarding } from "@/core/onboarding";
import { isInstalledBinary, performUpgrade } from "@/core/upgrade";

const rawArgs = process.argv.slice(2);
const CURRENT_VERSION = packageJson.version ?? "0.0.0";
const CLI_ENTRY = new URL(import.meta.url).pathname;
const BUN_EXECUTABLE: string = process.argv[0] ?? process.execPath;
const EXECUTABLE_PATH: string = process.execPath;
const INSTALLED_BINARY = isInstalledBinary();
const READY_WAIT_MS = 2 * 60 * 1000;
const READY_POLL_MS = 500;
const STOP_WAIT_MS = 30 * 1000;
const STOP_POLL_MS = 500;
const DAEMON_SPAWN_THROTTLE_MS = 3000;
const LOG_TAIL_BYTES = 200_000;
const LOG_TAIL_LINES = 40;
let lastDaemonSpawnAttemptAt = 0;

const foregroundRequested = rawArgs.includes("--foreground");
const args = foregroundRequested
  ? rawArgs.filter((arg) => arg !== "--foreground")
  : rawArgs;
const command = args[0];

function printHelp(): void {
  console.log(
    [
      "ode - OpenCode Slack bot",
      "",
      "Usage:",
      "  ode [--foreground]",
      "  ode status",
      "  ode restart",
      "  ode stop",
      "  ode onboarding",
      "  ode upgrade",
      "  ode --version",
      "",
      "Examples:",
      "  ode",
      "  ode status",
      "  ode restart",
      "  ode stop",
      "  ode --foreground",
    ].join("\n"),
  );
}

async function upgrade(): Promise<void> {
  if (!isInstalledBinary()) {
    console.error("ode upgrade must be run from the installed ode binary.");
    console.error("Install with: curl -fsSL https://raw.githubusercontent.com/odefun/ode/main/scripts/install.sh | bash");
    process.exit(1);
  }
  const { latestVersion } = await performUpgrade();
  if (latestVersion) {
    console.log(`ode upgraded (current version: ${latestVersion}).`);
    return;
  }

  console.log("ode upgraded.");
}

function getLocalSettingsUrl(): string {
  const host = getWebHost();
  const port = getWebPort();
  return `http://${host}:${port}/`;
}

function fallbackReadyMessage(): string {
  return `Ode is ready! Waiting for messages, setting UI is accessible at ${getLocalSettingsUrl()}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function daemonState(): DaemonState {
  return readDaemonState();
}

function managerRunning(state: DaemonState = daemonState()): boolean {
  return isProcessAlive(state.managerPid);
}

function runtimeRunning(state: DaemonState = daemonState()): boolean {
  return isProcessAlive(state.runtimePid);
}

function ensureDaemonRunning(): void {
  const state = daemonState();
  if (managerRunning(state)) return;
  const now = Date.now();
  if (now - lastDaemonSpawnAttemptAt < DAEMON_SPAWN_THROTTLE_MS) return;
  lastDaemonSpawnAttemptAt = now;
  const child = spawn(
    INSTALLED_BINARY ? EXECUTABLE_PATH : BUN_EXECUTABLE,
    INSTALLED_BINARY ? ["daemon"] : [CLI_ENTRY, "daemon"],
    {
    detached: true,
    stdio: "ignore",
    },
  );
  child.unref();
}

async function waitForReadyMessage(timeoutMs: number): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = daemonState();
    if (state.status === "ready" && typeof state.readyMessage === "string" && state.readyMessage.length > 0 && managerRunning(state)) {
      return state.readyMessage;
    }
    if (!managerRunning(state)) {
      ensureDaemonRunning();
    }
    await delay(READY_POLL_MS);
  }
  return null;
}

async function waitForStopped(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = daemonState();
    if (!managerRunning(state) && !runtimeRunning(state)) return true;
    await delay(STOP_POLL_MS);
  }
  return false;
}

async function startBackground(): Promise<void> {
  const state = daemonState();
  if (state.status === "ready" && state.readyMessage && managerRunning(state)) {
    console.log(state.readyMessage);
    return;
  }
  ensureDaemonRunning();
  const readyMessage = await waitForReadyMessage(READY_WAIT_MS);
  if (readyMessage) {
    console.log(readyMessage);
    return;
  }
  console.log(`Ode daemon is still starting. Follow logs at ${getDaemonLogPath()}`);
}

function tailLogs(maxLines: number): string[] {
  const logPath = getDaemonLogPath();
  try {
    const stats = statSync(logPath);
    if (stats.size === 0) return [];
    const bytes = Math.min(LOG_TAIL_BYTES, stats.size);
    const buffer = Buffer.alloc(Number(bytes));
    const fd = openSync(logPath, "r");
    try {
      readSync(fd, buffer, 0, Number(bytes), stats.size - bytes);
    } finally {
      closeSync(fd);
    }
    const content = buffer.toString("utf-8");
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function formatTimestamp(value: number | null): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

async function showStatus(): Promise<void> {
  const state = daemonState();
  const daemonStatus = managerRunning(state) ? `running (pid ${state.managerPid})` : "stopped";
  const runtimeStatus = runtimeRunning(state) ? `running (pid ${state.runtimePid})` : "stopped";
  console.log(`Daemon: ${daemonStatus}`);
  console.log(`Runtime: ${runtimeStatus}`);
  console.log(`Last start: ${formatTimestamp(state.lastStartAt)}`);
  console.log(`Last ready: ${formatTimestamp(state.lastReadyAt)}`);
  if (state.pendingUpgradeRestart) {
    console.log(
      `Pending upgrade restart since ${formatTimestamp(state.pendingUpgradeRestart.scheduledAt)} (${state.pendingUpgradeRestart.reason})`,
    );
  }
  const logs = tailLogs(LOG_TAIL_LINES);
  if (logs.length === 0) {
    console.log(`No logs yet. Log file: ${getDaemonLogPath()}`);
    return;
  }
  console.log(`Recent logs (${getDaemonLogPath()}):`);
  console.log(logs.join("\n"));
}

async function restartDaemonCommand(): Promise<void> {
  const state = daemonState();
  if (!managerRunning(state)) {
    console.log("Daemon not running. Starting a new daemon instance...");
    ensureDaemonRunning();
    const ready = await waitForReadyMessage(READY_WAIT_MS);
    console.log(ready ?? `Restart requested. Follow logs at ${getDaemonLogPath()}`);
    return;
  }

  if (runtimeRunning(state) && state.runtimePid) {
    try {
      process.kill(state.runtimePid, "SIGTERM");
      console.log(`Sent shutdown signal to runtime (pid ${state.runtimePid}).`);
    } catch (error) {
      console.warn(`Failed to signal runtime (pid ${state.runtimePid}): ${String(error)}`);
    }
  } else {
    console.log("Runtime is not currently running; waiting for daemon to restart.");
  }

  const ready = await waitForReadyMessage(READY_WAIT_MS);
  console.log(ready ?? `Restart requested. Follow logs at ${getDaemonLogPath()}`);
}

async function stopDaemonCommand(): Promise<void> {
  const state = daemonState();
  const managerAlive = managerRunning(state);
  const runtimeAlive = runtimeRunning(state);

  if (!managerAlive && !runtimeAlive) {
    console.log("Daemon already stopped.");
    return;
  }

  if (managerAlive && state.managerPid) {
    try {
      process.kill(state.managerPid, "SIGTERM");
      console.log(`Sent shutdown signal to daemon (pid ${state.managerPid}).`);
    } catch (error) {
      console.warn(`Failed to signal daemon (pid ${state.managerPid}): ${String(error)}`);
    }
  } else if (runtimeAlive && state.runtimePid) {
    try {
      process.kill(state.runtimePid, "SIGTERM");
      console.log(`Sent shutdown signal to runtime (pid ${state.runtimePid}).`);
    } catch (error) {
      console.warn(`Failed to signal runtime (pid ${state.runtimePid}): ${String(error)}`);
    }
  }

  const stopped = await waitForStopped(STOP_WAIT_MS);
  console.log(stopped ? "Daemon stopped." : `Stop requested. Follow logs at ${getDaemonLogPath()}`);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (command === "__runtime") {
  await import("./index");
  await new Promise(() => {});
}

if (command === "daemon") {
  await runDaemon();
  await new Promise(() => {});
}

if (args.includes("--version") || command === "version") {
  console.log(CURRENT_VERSION);
  process.exit(0);
}

if (command === "upgrade") {
  await upgrade();
  process.exit(0);
}

if (command === "onboarding") {
  await runOnboarding({ force: true });
  process.exit(0);
}

if (command === "status") {
  await showStatus();
  process.exit(0);
}

if (command === "restart") {
  await restartDaemonCommand();
  process.exit(0);
}

if (command === "stop") {
  await stopDaemonCommand();
  process.exit(0);
}

if (command === "start") {
  await startBackground();
  process.exit(0);
}

if (foregroundRequested) {
  await import("./index");
  await new Promise(() => {});
}

await startBackground();
