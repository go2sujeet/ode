import type { CoreMessageContext } from "@/core/types";

export type IMPlatform = "slack" | "discord" | "lark";

export type UnifiedMessageContext = {
  platform: IMPlatform;
  channelId: string;
  threadId: string;
  replyThreadId: string;
  messageId: string;
  userId: string;
  isTopLevel: boolean;
  mentionedBot: boolean;
  activeThread: boolean;
  rawText: string;
  normalizedText: string;
};

export type IncomingDropReason = "not_mentioned_and_inactive";

export function shouldProcessIncomingMessage(
  context: Pick<UnifiedMessageContext, "isTopLevel" | "mentionedBot" | "activeThread">
): boolean {
  if (context.isTopLevel) {
    return context.mentionedBot;
  }
  return context.mentionedBot || context.activeThread;
}

export function getIncomingDropReason(
  context: Pick<UnifiedMessageContext, "isTopLevel" | "mentionedBot" | "activeThread">
): IncomingDropReason | null {
  return shouldProcessIncomingMessage(context) ? null : "not_mentioned_and_inactive";
}

export function formatIncomingDropMessage(reason: IncomingDropReason): string {
  switch (reason) {
    case "not_mentioned_and_inactive":
      return "[DROP] Not mentioned and thread inactive";
  }
}

export function toCoreMessageContext(
  context: Pick<UnifiedMessageContext, "channelId" | "threadId" | "replyThreadId" | "messageId" | "userId">,
  extras?: Pick<CoreMessageContext, "workspaceName">
): CoreMessageContext {
  return {
    channelId: context.channelId,
    threadId: context.threadId,
    replyThreadId: context.replyThreadId,
    messageId: context.messageId,
    userId: context.userId,
    workspaceName: extras?.workspaceName,
  };
}
