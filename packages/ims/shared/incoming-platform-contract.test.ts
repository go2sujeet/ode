import { describe, expect, it } from "bun:test";
import { IncomingMessageProcessor, buildIncomingContext } from "@/ims/shared/incoming-message-processor";

type PlatformCase = {
  name: string;
  isTopLevel: boolean;
  mentionedBot: boolean;
  activeThread: boolean;
  normalizedText: string;
  detectStop?: boolean;
  expected: ReturnType<IncomingMessageProcessor["evaluate"]>;
};

const contractCases: PlatformCase[] = [
  {
    name: "top-level non mention ignored",
    isTopLevel: true,
    mentionedBot: false,
    activeThread: false,
    normalizedText: "hello",
    expected: { type: "ignore", reason: "not_mentioned_and_inactive" },
  },
  {
    name: "top-level mention forwarded",
    isTopLevel: true,
    mentionedBot: true,
    activeThread: false,
    normalizedText: "hello",
    expected: { type: "forward", text: "hello" },
  },
  {
    name: "thread active forwarded without mention",
    isTopLevel: false,
    mentionedBot: false,
    activeThread: true,
    normalizedText: "thread followup",
    expected: { type: "forward", text: "thread followup" },
  },
  {
    name: "empty text ignored",
    isTopLevel: false,
    mentionedBot: true,
    activeThread: true,
    normalizedText: "  ",
    expected: { type: "ignore", reason: "empty_text" },
  },
  {
    name: "stop command honored by default",
    isTopLevel: false,
    mentionedBot: true,
    activeThread: true,
    normalizedText: "stop",
    expected: { type: "stop", text: "stop" },
  },
  {
    name: "stop detection can be disabled",
    isTopLevel: false,
    mentionedBot: true,
    activeThread: true,
    normalizedText: "stop",
    detectStop: false,
    expected: { type: "forward", text: "stop" },
  },
];

describe("incoming message platform contract", () => {
  const processor = new IncomingMessageProcessor();
  const platforms = ["slack", "discord", "lark"] as const;

  for (const platform of platforms) {
    it(`${platform} follows shared incoming decision contract`, () => {
      for (const testCase of contractCases) {
        const context = buildIncomingContext({
          platform,
          channelId: `${platform}-channel`,
          threadId: `${platform}-thread`,
          messageId: `${platform}-message`,
          userId: `${platform}-user`,
          isTopLevel: testCase.isTopLevel,
          mentionedBot: testCase.mentionedBot,
          activeThread: testCase.activeThread,
          rawText: testCase.normalizedText,
          normalizedText: testCase.normalizedText,
        });

        const actual = processor.evaluate(context, { detectStop: testCase.detectStop });
        expect(actual).toEqual(testCase.expected);
      }
    });
  }
});
