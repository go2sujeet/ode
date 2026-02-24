import type { UnifiedMessageContext, IncomingDropReason } from "@/ims/shared/message-context";

export type IncomingPipelineResult =
  | { type: "ignore"; reason: IncomingDropReason | "empty_text" }
  | { type: "stop"; text: string }
  | { type: "forward"; text: string };

export type IncomingPipelineOptions = {
  detectStop?: boolean;
};

export function evaluateIncomingMessage(
  context: Pick<UnifiedMessageContext, "isTopLevel" | "mentionedBot" | "activeThread" | "normalizedText">,
  isStopCommand: (text: string) => boolean,
  options?: IncomingPipelineOptions
): IncomingPipelineResult {
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

  if (options?.detectStop !== false && isStopCommand(text)) {
    return { type: "stop", text };
  }

  return { type: "forward", text };
}
