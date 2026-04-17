import { describe, expect, test } from "bun:test";
import { isRateLimitError, getRetryAfterMs } from "./rate-limit";

describe("shared isRateLimitError", () => {
  test("matches explicit 429 / rate-limited strings", () => {
    expect(isRateLimitError(new Error("status 429"))).toBe(true);
    expect(isRateLimitError(new Error("rate_limited"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("ratelimit"))).toBe(true);
  });

  test("matches Slack SDK error shape with data.retry_after", () => {
    const err = Object.assign(new Error("An API error occurred: something"), {
      data: { retry_after: 30, error: "unknown" },
    });
    expect(isRateLimitError(err)).toBe(true);
  });

  test("matches Discord-style err.code containing 'rate'", () => {
    const err = Object.assign(new Error("http 429"), { code: "RateLimitedError" });
    expect(isRateLimitError(err)).toBe(true);
  });

  test("rejects unrelated errors", () => {
    expect(isRateLimitError(new Error("channel_not_found"))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
    expect(isRateLimitError({ data: {} })).toBe(false);
  });
});

describe("getRetryAfterMs", () => {
  test("extracts Slack-style seconds", () => {
    expect(getRetryAfterMs({ data: { retry_after: 30 } })).toBe(30_000);
  });

  test("returns millisecond values as-is", () => {
    expect(getRetryAfterMs({ retry_after: 2500 })).toBe(2500);
    expect(getRetryAfterMs({ retryAfter: 7500 })).toBe(7500);
  });

  test("parses string numerics", () => {
    expect(getRetryAfterMs({ data: { retry_after: "10" } })).toBe(10_000);
  });

  test("returns undefined for missing/invalid", () => {
    expect(getRetryAfterMs(null)).toBeUndefined();
    expect(getRetryAfterMs(new Error("boom"))).toBeUndefined();
    expect(getRetryAfterMs({ data: { retry_after: "nope" } })).toBeUndefined();
  });
});
