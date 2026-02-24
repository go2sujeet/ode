export const STATUS_MESSAGE_FREQUENCY_OPTIONS = [
  { ms: 5000, value: "5000", label: "5 seconds" },
  { ms: 8000, value: "8000", label: "8 seconds" },
  { ms: 12000, value: "12000", label: "12 seconds" },
] as const;

export type StatusMessageFrequencyMs = (typeof STATUS_MESSAGE_FREQUENCY_OPTIONS)[number]["ms"];
export type StatusMessageFrequencyValue = (typeof STATUS_MESSAGE_FREQUENCY_OPTIONS)[number]["value"];

export const DEFAULT_STATUS_MESSAGE_FREQUENCY_MS: StatusMessageFrequencyMs = 5000;

export function isStatusMessageFrequencyMs(value: unknown): value is StatusMessageFrequencyMs {
  return value === 5000 || value === 8000 || value === 12000;
}

export function parseStatusMessageFrequencyMs(value: unknown): StatusMessageFrequencyMs {
  return isStatusMessageFrequencyMs(value) ? value : DEFAULT_STATUS_MESSAGE_FREQUENCY_MS;
}

export function isStatusMessageFrequencyValue(value: string): value is StatusMessageFrequencyValue {
  return value === "5000" || value === "8000" || value === "12000";
}

export function parseStatusMessageFrequencyValue(value: string): StatusMessageFrequencyValue | null {
  const normalized = value.trim();
  return isStatusMessageFrequencyValue(normalized) ? normalized : null;
}

export function toStatusMessageFrequencyValue(ms: StatusMessageFrequencyMs): StatusMessageFrequencyValue {
  return String(ms) as StatusMessageFrequencyValue;
}
