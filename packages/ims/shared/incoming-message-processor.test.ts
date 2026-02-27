import { describe, expect, it, mock } from "bun:test";
import { IncomingMessageProcessor, buildIncomingContext } from "./incoming-message-processor";

describe("IncomingMessageProcessor", () => {
  it("evaluates behavior matrix for top-level and thread messages", () => {
    const processor = new IncomingMessageProcessor();

    const cases: Array<{
      name: string;
      input: {
        isTopLevel: boolean;
        mentionedBot: boolean;
        activeThread: boolean;
        normalizedText: string;
      };
      detectStop?: boolean;
      expected: ReturnType<IncomingMessageProcessor["evaluate"]>;
    }> = [
      {
        name: "top-level without mention is ignored",
        input: { isTopLevel: true, mentionedBot: false, activeThread: false, normalizedText: "hello" },
        expected: { type: "ignore", reason: "not_mentioned_and_inactive" },
      },
      {
        name: "top-level mention forwards",
        input: { isTopLevel: true, mentionedBot: true, activeThread: false, normalizedText: "hello" },
        expected: { type: "forward", text: "hello" },
      },
      {
        name: "thread active without mention forwards",
        input: { isTopLevel: false, mentionedBot: false, activeThread: true, normalizedText: "hello" },
        expected: { type: "forward", text: "hello" },
      },
      {
        name: "blank normalized text is ignored",
        input: { isTopLevel: false, mentionedBot: true, activeThread: true, normalizedText: "   " },
        expected: { type: "ignore", reason: "empty_text" },
      },
      {
        name: "stop command detected by default",
        input: { isTopLevel: false, mentionedBot: true, activeThread: true, normalizedText: "stop" },
        expected: { type: "stop", text: "stop" },
      },
      {
        name: "stop command can be disabled",
        input: { isTopLevel: false, mentionedBot: true, activeThread: true, normalizedText: "stop" },
        detectStop: false,
        expected: { type: "forward", text: "stop" },
      },
    ];

    for (const testCase of cases) {
      const actual = processor.evaluate(testCase.input, { detectStop: testCase.detectStop });
      expect(actual).toEqual(testCase.expected);
    }
  });

  it("executes forward/stop/ignore branches with side-effect isolation", async () => {
    const processor = new IncomingMessageProcessor();
    const markThreadActive = mock(() => {});
    const handleStopCommand = mock(async () => true);
    const sendStopAck = mock(async () => {});
    const forwardToCore = mock(async () => {});
    const onIgnore = mock(() => {});

    await processor.execute({
      context: { channelId: "C1", threadId: "T1" },
      flowResult: { type: "ignore", reason: "empty_text" },
      markThreadActive,
      handleStopCommand,
      sendStopAck,
      forwardToCore,
      onIgnore,
    });

    await processor.execute({
      context: { channelId: "C1", threadId: "T1" },
      flowResult: { type: "stop", text: "stop" },
      markThreadActive,
      handleStopCommand,
      sendStopAck,
      forwardToCore,
      onIgnore,
    });

    await processor.execute({
      context: { channelId: "C1", threadId: "T1" },
      flowResult: { type: "forward", text: "hello" },
      markThreadActive,
      handleStopCommand,
      sendStopAck,
      forwardToCore,
      onIgnore,
    });

    expect(onIgnore).toHaveBeenCalledWith("empty_text");
    expect(handleStopCommand).toHaveBeenCalledWith("C1", "T1");
    expect(sendStopAck).toHaveBeenCalledTimes(1);
    expect(markThreadActive).toHaveBeenCalledWith("C1", "T1");
    expect(forwardToCore).toHaveBeenCalledWith("hello");
  });

  it("parses command variants and normalizes context", () => {
    const processor = new IncomingMessageProcessor();
    expect(processor.parseCommand("<@U123> settings")).toBe("setting");
    expect(processor.parseCommand("@ode: setting")).toBe("setting");
    expect(processor.parseCommand("／settings")).toBe("setting");
    expect(processor.parseCommand("help")).toBeNull();

    const context = buildIncomingContext({
      platform: "slack",
      channelId: " C1 ",
      threadId: " T1 ",
      messageId: " m1 ",
      userId: " U1 ",
      isTopLevel: true,
      mentionedBot: true,
      activeThread: false,
      rawText: "raw",
      normalizedText: "clean",
    });
    expect(context.channelId).toBe("C1");
    expect(context.threadId).toBe("T1");
    expect(context.replyThreadId).toBe("T1");
    expect(processor.formatDropMessage("not_mentioned_and_inactive")).toContain("Not mentioned");
  });
});
