import { loadOdeConfig } from "./local/ode";
import { DEFAULT_STATUS_MESSAGE_FREQUENCY_MS } from "./status-message-frequency";

const DEFAULT_MESSAGE_UPDATE_INTERVAL_MS = DEFAULT_STATUS_MESSAGE_FREQUENCY_MS;
const MIN_MESSAGE_UPDATE_INTERVAL_MS = 250;

export function resolveMessageUpdateIntervalMs(): number {
  try {
    const user = loadOdeConfig().user;
    const value = user.IM_MESSAGE_UPDATE_INTERVAL_MS ?? user.messageUpdateIntervalMs;
    if (Number.isFinite(value) && value > 0) {
      return Math.max(value, MIN_MESSAGE_UPDATE_INTERVAL_MS);
    }
  } catch {
    // ignore, fall back to default
  }
  return DEFAULT_MESSAGE_UPDATE_INTERVAL_MS;
}
