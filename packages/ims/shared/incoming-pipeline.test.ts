import { describe, expect, it } from "bun:test";
import { evaluateIncomingMessage } from "./incoming-pipeline";
import { isStopCommand } from "./stop-command";

describe("evaluateIncomingMessage", () => {
  it("drops messages when top-level mention is missing", () => {
    const result = evaluateIncomingMessage(
      {
        isTopLevel: true,
        mentionedBot: false,
        activeThread: true,
        normalizedText: "hello",
      },
      isStopCommand
    );

    expect(result).toEqual({ type: "ignore", reason: "not_mentioned_and_inactive" });
  });

  it("accepts thread message for active threads", () => {
    const result = evaluateIncomingMessage(
      {
        isTopLevel: false,
        mentionedBot: false,
        activeThread: true,
        normalizedText: "hello",
      },
      isStopCommand
    );

    expect(result).toEqual({ type: "forward", text: "hello" });
  });

  it("returns stop action for exact stop command", () => {
    const result = evaluateIncomingMessage(
      {
        isTopLevel: false,
        mentionedBot: true,
        activeThread: false,
        normalizedText: "stop",
      },
      isStopCommand
    );

    expect(result).toEqual({ type: "stop", text: "stop" });
  });

  it("can disable stop detection", () => {
    const result = evaluateIncomingMessage(
      {
        isTopLevel: true,
        mentionedBot: true,
        activeThread: false,
        normalizedText: "stop",
      },
      isStopCommand,
      { detectStop: false }
    );

    expect(result).toEqual({ type: "forward", text: "stop" });
  });
});
