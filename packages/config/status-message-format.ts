import { loadOdeConfig } from "./local/ode";
import { TOOL_DISPLAY_CONFIG, type StatusMessageFormat } from "./baseConfig";

export { TOOL_DISPLAY_CONFIG, type StatusMessageFormat };

export function resolveStatusMessageFormat(): StatusMessageFormat {
  try {
    const statusMessageFormat = loadOdeConfig().user.defaultStatusMessageFormat;
    if (
      statusMessageFormat === "minimum"
      || statusMessageFormat === "medium"
      || statusMessageFormat === "aggressive"
    ) {
      return statusMessageFormat;
    }
  } catch {
    // ignore, fall back to medium
  }
  return "medium";
}
