/**
 * Shared rate-limit detection logic.
 *
 * Lives in @/shared so both @/core (runtime adapters) and @/ims (platform
 * clients) can use the same detection — previously each layer had its own
 * detector and the core one was weaker, letting Slack SDK errors that carry
 * `data.retry_after` but no "429" substring escape detection. That caused
 * `wasRateLimited()` to return false when it shouldn't, which in turn made
 * the finalization path attempt a real edit/delete on an already-rate-limited
 * message, amplifying the 429 burst.
 */

export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const message = stringifyError(err).toLowerCase();
  if (
    message.includes("429") ||
    message.includes("rate_limited") ||
    message.includes("rate limit") ||
    message.includes("ratelimit")
  ) {
    return true;
  }
  if (typeof err === "object" && err !== null) {
    const data = (err as { data?: { retry_after?: unknown } }).data;
    if (data && typeof data.retry_after !== "undefined") return true;
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.toLowerCase().includes("rate")) return true;
  }
  return false;
}

/**
 * Best-effort extraction of a `Retry-After` hint in milliseconds.
 * Slack SDK surfaces `err.data.retry_after` in seconds. Discord uses
 * `err.retry_after` in ms or seconds depending on context; we normalize
 * conservatively (values < 1000 treated as seconds).
 */
export function getRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const record = err as {
    data?: { retry_after?: unknown };
    retry_after?: unknown;
    retryAfter?: unknown;
  };
  const candidate =
    record.data?.retry_after ?? record.retry_after ?? record.retryAfter;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate < 1000 ? candidate * 1000 : candidate;
  }
  if (typeof candidate === "string") {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed < 1000 ? parsed * 1000 : parsed;
    }
  }
  return undefined;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
