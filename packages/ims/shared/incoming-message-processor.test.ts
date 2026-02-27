import { describe, expect, it } from "bun:test";
import {
  formatIncomingDropMessage,
  parseIncomingCommand,
} from "./incoming-message-processor";

describe("incoming message flow helpers", () => {
  it("parses command variants", () => {
    expect(parseIncomingCommand("<@U123> settings")).toBe("setting");
    expect(parseIncomingCommand("@ode: setting")).toBe("setting");
    expect(parseIncomingCommand("／settings")).toBe("setting");
    expect(parseIncomingCommand("help")).toBeNull();
  });

  it("formats drop reason messages", () => {
    expect(formatIncomingDropMessage("not_mentioned_and_inactive")).toContain("Not mentioned");
    expect(formatIncomingDropMessage("self_message")).toContain("Self message");
    expect(formatIncomingDropMessage("not_thread_owner")).toContain("owner");
    expect(formatIncomingDropMessage("mention_required_in_multi_bot_thread")).toContain("Mention required");
  });
});
