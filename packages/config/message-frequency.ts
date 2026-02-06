import { loadOdeConfig } from "./local/ode";
import { TOOL_DISPLAY_CONFIG, type MessageFrequency } from "./baseConfig";

export { TOOL_DISPLAY_CONFIG, type MessageFrequency };

export function resolveMessageFrequency(): MessageFrequency {
  try {
    const frequency = loadOdeConfig().user.defaultMessageFrequency;
    if (frequency === "minimum" || frequency === "medium" || frequency === "aggressive") {
      return frequency;
    }
  } catch {
    // ignore, fall back to medium
  }
  return "medium";
}
