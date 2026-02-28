import type { InboundDecision } from "@/core/model/inbound-decision";

export function defaultInboundPolicy(params: {
  selfMessage: boolean;
  threadOwnerMessage: boolean;
  isTopLevel: boolean;
  hasAnyMention: boolean;
  mentionedBot: boolean;
  activeThread: boolean;
  normalizedText: string;
  detectStop?: boolean;
}): InboundDecision {
  if (params.selfMessage) {
    return { kind: "ignore", reason: "self_message" };
  }

  if (!params.isTopLevel && params.hasAnyMention && !params.mentionedBot) {
    return { kind: "ignore", reason: "not_mentioned_and_inactive" };
  }

  if (!params.isTopLevel && !params.mentionedBot) {
    if (!params.activeThread) {
      return { kind: "ignore", reason: "not_mentioned_and_inactive" };
    }
    if (!params.threadOwnerMessage) {
      return { kind: "ignore", reason: "not_thread_owner" };
    }
  }

  const shouldProcess = params.isTopLevel
    ? params.mentionedBot
    : (params.mentionedBot || params.activeThread);

  if (!shouldProcess) {
    return { kind: "ignore", reason: "not_mentioned_and_inactive" };
  }

  const text = params.normalizedText.trim();
  if (!text) {
    return { kind: "ignore", reason: "empty_text" };
  }

  if (params.detectStop !== false && text.toLowerCase() === "stop") {
    return { kind: "stop" };
  }

  return { kind: "message", text };
}
