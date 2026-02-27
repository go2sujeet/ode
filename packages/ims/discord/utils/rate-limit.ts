export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDiscordRateLimitErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("429") || normalized.includes("rate limit") || normalized.includes("ratelimit");
}

export function parseDiscordRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as {
    retry_after?: unknown;
    data?: { retry_after?: unknown };
    rawError?: { retry_after?: unknown };
    message?: unknown;
  };

  const retryAfterCandidates = [
    record.retry_after,
    record.data?.retry_after,
    record.rawError?.retry_after,
  ];

  for (const candidate of retryAfterCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate <= 30 ? Math.ceil(candidate * 1000) : Math.ceil(candidate);
    }
  }

  const message = typeof record.message === "string" ? record.message : "";
  const matched = message.match(/retry(?:_|\s)?after[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
  if (!matched?.[1]) return null;
  const parsed = Number(matched[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed <= 30 ? Math.ceil(parsed * 1000) : Math.ceil(parsed);
}
