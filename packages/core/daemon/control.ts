import { patchDaemonState } from "./state";
import type { DaemonState } from "./state";

function safePatch(updater: () => Partial<DaemonState>): void {
  try {
    patchDaemonState(updater());
  } catch {
    // Best effort only; ignore persistence errors.
  }
}

export function markRuntimeReady(message: string, runtimeVersion: string): void {
  safePatch(() => ({
    readyMessage: message,
    runtimeVersion,
    status: "ready",
    lastReadyAt: Date.now(),
  }));
}

export function clearRuntimeReadyState(): void {
  safePatch(() => ({
    readyMessage: null,
    runtimeVersion: null,
    lastReadyAt: null,
    status: "starting",
  }));
}

export function scheduleUpgradeRestart(reason: string): void {
  safePatch(() => ({
    pendingUpgradeRestart: {
      reason,
      scheduledAt: Date.now(),
    },
  }));
}

export function clearPendingUpgradeRestart(): void {
  safePatch(() => ({ pendingUpgradeRestart: null }));
}
