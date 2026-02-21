import { loadOdeConfig } from "./local/ode";

const DEFAULT_MESSAGE_UPDATE_INTERVAL_MS = 2000;
const MIN_MESSAGE_UPDATE_INTERVAL_MS = 250;

export function resolveMessageUpdateIntervalMs(): number {
  try {
    const value = loadOdeConfig().user.messageUpdateIntervalMs;
    if (Number.isFinite(value) && value > 0) {
      return Math.max(value, MIN_MESSAGE_UPDATE_INTERVAL_MS);
    }
  } catch {
    // ignore, fall back to default
  }
  return DEFAULT_MESSAGE_UPDATE_INTERVAL_MS;
}
