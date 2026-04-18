import { describe, expect, it } from "bun:test";
import { isBenignDeliveryFailure } from "@/core/observability/sentry";

describe("isBenignDeliveryFailure", () => {
  it("flags Slack message_not_found on update as benign", () => {
    expect(
      isBenignDeliveryFailure({
        op: "update",
        error: "An API error occurred: message_not_found",
      }),
    ).toBe(true);
  });

  it("flags Slack message_not_found on delete as benign", () => {
    expect(
      isBenignDeliveryFailure({
        op: "delete",
        error: "An API error occurred: message_not_found",
      }),
    ).toBe(true);
  });

  it("flags Discord unknown_message on update as benign", () => {
    expect(
      isBenignDeliveryFailure({
        op: "update",
        error: "Unknown Message (unknown_message)",
      }),
    ).toBe(true);
  });

  it("does not flag channel_not_found as benign (bot may have been removed)", () => {
    expect(
      isBenignDeliveryFailure({
        op: "send",
        error: "An API error occurred: channel_not_found",
      }),
    ).toBe(false);
  });

  it("does not flag benign-looking errors on send", () => {
    // Send failures should never be treated as benign — if a send fails,
    // the user didn't get the message.
    expect(
      isBenignDeliveryFailure({
        op: "send",
        error: "message_not_found",
      }),
    ).toBe(false);
  });

  it("does not flag generic auth errors as benign", () => {
    expect(
      isBenignDeliveryFailure({
        op: "update",
        error: "invalid_auth",
      }),
    ).toBe(false);
  });
});
