export function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    const normalized = toTrimmedString(value);
    if (normalized.length > 0) return normalized;
  }
  return "";
}

export function pickValueField(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return firstNonEmptyString(record[key], record[key.replace(/_([a-z])/g, (_, s) => s.toUpperCase())]);
}

export function pickActionSelectedOption(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  const event = root.event && typeof root.event === "object" ? root.event as Record<string, unknown> : null;
  const action = event?.action && typeof event.action === "object" ? event.action as Record<string, unknown> : null;
  const option = action?.option && typeof action.option === "object" ? action.option as Record<string, unknown> : null;
  const options = action?.options && Array.isArray(action.options) ? action.options as unknown[] : [];

  const fromOption = firstNonEmptyString(option?.value);
  if (fromOption) return fromOption;

  for (const item of options) {
    if (!item || typeof item !== "object") continue;
    const value = firstNonEmptyString((item as Record<string, unknown>).value);
    if (value) return value;
  }

  return "";
}

export function extractFormValues(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== "object") return {};
  const root = payload as Record<string, unknown>;
  const event = root.event && typeof root.event === "object" ? root.event as Record<string, unknown> : null;
  const action = event?.action && typeof event.action === "object" ? event.action as Record<string, unknown> : null;
  const form = action?.form_value && typeof action.form_value === "object"
    ? action.form_value as Record<string, unknown>
    : root.form_value && typeof root.form_value === "object"
      ? root.form_value as Record<string, unknown>
      : {};
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const directValue = firstNonEmptyString(record.value);
    if (directValue) {
      normalized[key] = directValue;
      continue;
    }
    const option = record.option && typeof record.option === "object" ? record.option as Record<string, unknown> : null;
    const optionValue = firstNonEmptyString(option?.value);
    if (optionValue) {
      normalized[key] = optionValue;
      continue;
    }
    const options = Array.isArray(record.options) ? record.options : [];
    for (const item of options) {
      if (!item || typeof item !== "object") continue;
      const itemValue = firstNonEmptyString((item as Record<string, unknown>).value);
      if (itemValue) {
        normalized[key] = itemValue;
        break;
      }
    }
  }
  return normalized;
}

export function pickFormValue(
  formValues: Record<string, string>,
  key: string
): { exists: boolean; value: string } {
  if (Object.prototype.hasOwnProperty.call(formValues, key)) {
    return {
      exists: true,
      value: formValues[key] ?? "",
    };
  }
  return {
    exists: false,
    value: "",
  };
}
