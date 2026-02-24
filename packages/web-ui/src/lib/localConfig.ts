export {
  defaultDashboardConfig,
  sanitizeDashboardConfig,
  type DashboardConfig,
} from "@/config/dashboard-config";

export {
  STATUS_MESSAGE_FREQUENCY_OPTIONS,
  DEFAULT_STATUS_MESSAGE_FREQUENCY_MS,
  parseStatusMessageFrequencyMs,
  toStatusMessageFrequencyValue,
  type StatusMessageFrequencyMs,
  type StatusMessageFrequencyValue,
} from "@/config/status-message-frequency";

export { type GitStrategy, type StatusMessageFormat, TOOL_DISPLAY_CONFIG } from "@/config/web";
