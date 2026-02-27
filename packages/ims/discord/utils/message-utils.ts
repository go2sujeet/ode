export function splitForDiscord(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + limit));
    index += limit;
  }
  return chunks;
}

export function cleanBotMention(content: string, botUserId: string): string {
  const mentionPatterns = [
    new RegExp(`<@${botUserId}>`, "g"),
    new RegExp(`<@!${botUserId}>`, "g"),
  ];
  let text = content;
  for (const pattern of mentionPatterns) {
    text = text.replace(pattern, " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

export function isTopLevelMessage(message: any): boolean {
  return !message.channel?.isThread?.();
}

export function buildMeaningfulThreadName(text: string, limit: number): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[`*_~>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return `thread-${Date.now()}`;
  }

  return cleaned.slice(0, limit).trim();
}

export function formatThreadNameFromBranch(branchName: string, limit: number): string {
  const trimmed = branchName.trim();
  if (!trimmed) return "";
  const normalized = trimmed
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return normalized.slice(0, limit);
}

export function formatThreadNameFromStatusTitle(title: string, limit: number): string {
  const normalized = title
    .replace(/[\r\n]+/g, " ")
    .replace(/[`*_~>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.slice(0, limit).trim();
}
