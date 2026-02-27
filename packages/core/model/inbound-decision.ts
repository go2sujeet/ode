export type InboundIgnoreReason = "not_mentioned_and_inactive" | "empty_text";

export type InboundDecision =
  | { kind: "ignore"; reason: InboundIgnoreReason }
  | { kind: "stop" }
  | { kind: "message"; text: string };
