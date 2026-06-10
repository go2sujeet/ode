import type { OpenCodeMessageContext, OpenCodeOptions, PromptPart, SlackContext } from "./types";

export function buildSystemPrompt(slack?: SlackContext): string {
  return slack?.channelSystemMessage?.trim() ?? "";
}

export function buildPromptParts(
  _channelId: string,
  message: string,
  _options?: OpenCodeOptions,
  context?: OpenCodeMessageContext
): PromptPart[] {
  const parts: PromptPart[] = [];

  if (context?.threadHistory) {
    parts.push({
      type: "text",
      text: `<thread-history>\n${context.threadHistory}\n</thread-history>`,
    });
  }

  parts.push({ type: "text", text: message });

  return parts;
}

export function buildPromptText(parts: PromptPart[]): string {
  return parts.map((part) => part.text).join("\n\n");
}

export function buildSystemWrappedPrompt(systemPrompt: string, prompt: string): string {
  const trimmedSystemPrompt = systemPrompt.trim();
  if (!trimmedSystemPrompt) return prompt;
  return `<system-prompt>\n${trimmedSystemPrompt}\n</system-prompt>\n\n${prompt}`;
}
