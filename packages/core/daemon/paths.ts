import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const baseConfigDir = join(homedir(), ".config", "ode");
const daemonDir = join(baseConfigDir, "daemon");

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function ensureDaemonDir(): void {
  ensureDir(baseConfigDir);
  ensureDir(daemonDir);
}

export function getDaemonDir(): string {
  ensureDaemonDir();
  return daemonDir;
}

export function getDaemonStatePath(): string {
  return join(getDaemonDir(), "state.json");
}

export function getDaemonLogPath(): string {
  return join(getDaemonDir(), "daemon.log");
}

export function getDaemonPidPath(): string {
  return join(getDaemonDir(), "manager.pid");
}
