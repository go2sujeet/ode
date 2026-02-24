import type { UnifiedMessageContext } from "@/ims/shared/message-context";

export type IncomingIgnoreReason = "not_mentioned_and_inactive" | "empty_text";

export type IncomingPipelineResult =
  | { type: "ignore"; reason: IncomingIgnoreReason }
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

export function formatIncomingDropMessage(reason: IncomingIgnoreReason): string {
  switch (reason) {
    case "not_mentioned_and_inactive":
      return "[DROP] Not mentioned and thread inactive";
    case "empty_text":
      return "[DROP] Empty text after normalization";
  }
}
