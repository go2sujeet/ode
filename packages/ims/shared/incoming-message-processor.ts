export type IncomingIgnoreReason = "not_mentioned_and_inactive" | "empty_text";

export type IncomingFlowResult =
  | { type: "ignore"; reason: IncomingIgnoreReason }
  | { type: "stop"; text: string }
  | { type: "forward"; text: string };

export type IncomingCommand = "setting";

export function formatIncomingDropMessage(reason: IncomingIgnoreReason): string {
  switch (reason) {
    case "not_mentioned_and_inactive":
      return "[DROP] Not mentioned and thread inactive";
    case "empty_text":
      return "[DROP] Empty text after normalization";
  }
}

export function parseIncomingCommand(text: string): IncomingCommand | null {
  const normalized = text
    .trim()
    .replace(/^／/, "/")
    .replace(/^(?:<@[^>]+>|@[^\s:：,，]+)[:：,，]?\s+/g, "")
    .toLowerCase();
  if (/^\/?settings?\b/.test(normalized)) return "setting";
  return null;
}
