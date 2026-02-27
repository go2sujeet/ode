import type { UnifiedMessageContext } from "@/ims/shared/message-context";

export type IncomingIgnoreReason = "not_mentioned_and_inactive" | "empty_text";

export type IncomingFlowResult =
  | { type: "ignore"; reason: IncomingIgnoreReason }
  | { type: "stop"; text: string }
  | { type: "forward"; text: string };

export type IncomingEvaluateOptions = {
  detectStop?: boolean;
};

type IncomingExecuteParams = {
  context: Pick<UnifiedMessageContext, "channelId" | "threadId">;
  flowResult: IncomingFlowResult;
  markThreadActive: (channelId: string, threadId: string) => void;
  handleStopCommand: (channelId: string, threadId: string) => Promise<boolean>;
  sendStopAck?: () => Promise<void>;
  forwardToCore: (text: string) => Promise<void>;
  onIgnore?: (reason: IncomingIgnoreReason) => Promise<void> | void;
};

type IncomingMessageProcessorOptions = {
  isStopCommand?: (text: string) => boolean;
};

export class IncomingMessageProcessor {
  private readonly isStopCommand: (text: string) => boolean;

  constructor(options?: IncomingMessageProcessorOptions) {
    this.isStopCommand = options?.isStopCommand ?? isStopCommand;
  }

  evaluate(
    context: Pick<UnifiedMessageContext, "isTopLevel" | "mentionedBot" | "activeThread" | "normalizedText">,
    options?: IncomingEvaluateOptions
  ): IncomingFlowResult {
    const shouldProcess = context.isTopLevel
      ? context.mentionedBot
      : (context.mentionedBot || context.activeThread);

    if (!shouldProcess) {
      return { type: "ignore", reason: "not_mentioned_and_inactive" };
    }

    const text = context.normalizedText.trim();
    if (!text) {
      return { type: "ignore", reason: "empty_text" };
    }

    if (options?.detectStop !== false && this.isStopCommand(text)) {
      return { type: "stop", text };
    }

    return { type: "forward", text };
  }

  async execute(params: IncomingExecuteParams): Promise<void> {
    const {
      context,
      flowResult,
      markThreadActive,
      handleStopCommand,
      sendStopAck,
      forwardToCore,
      onIgnore,
    } = params;

    if (flowResult.type === "ignore") {
      await onIgnore?.(flowResult.reason);
      return;
    }

    if (flowResult.type === "stop") {
      const stopped = await handleStopCommand(context.channelId, context.threadId);
      if (stopped) {
        await sendStopAck?.();
      }
      return;
    }

    markThreadActive(context.channelId, context.threadId);
    await forwardToCore(flowResult.text);
  }

  formatDropMessage(reason: IncomingIgnoreReason): string {
    switch (reason) {
      case "not_mentioned_and_inactive":
        return "[DROP] Not mentioned and thread inactive";
      case "empty_text":
        return "[DROP] Empty text after normalization";
    }
  }

  parseCommand(text: string): IncomingCommand | null {
    const normalized = text
      .trim()
      .replace(/^／/, "/")
      .replace(/^(?:<@[^>]+>|@[^\s:：,，]+)[:：,，]?\s+/g, "")
      .toLowerCase();
    if (/^\/?settings?\b/.test(normalized)) return "setting";
    return null;
  }
}

export type IncomingCommand = "setting";

export function buildIncomingContext(params: {
  platform: UnifiedMessageContext["platform"];
  channelId: string;
  threadId: string;
  replyThreadId?: string;
  messageId: string;
  userId: string;
  isTopLevel: boolean;
  mentionedBot: boolean;
  activeThread: boolean;
  rawText: string;
  normalizedText: string;
}): UnifiedMessageContext {
  return {
    platform: params.platform,
    channelId: params.channelId.trim(),
    threadId: params.threadId.trim(),
    replyThreadId: (params.replyThreadId ?? params.threadId).trim(),
    messageId: params.messageId.trim(),
    userId: params.userId.trim(),
    isTopLevel: params.isTopLevel,
    mentionedBot: params.mentionedBot,
    activeThread: params.activeThread,
    rawText: params.rawText,
    normalizedText: params.normalizedText,
  };
}

export function isStopCommand(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length === 4 && trimmed.toLowerCase() === "stop";
}
