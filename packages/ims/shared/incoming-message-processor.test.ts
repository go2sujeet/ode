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
  });
});
