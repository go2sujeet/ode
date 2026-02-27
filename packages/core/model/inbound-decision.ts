export type InboundIgnoreReason =
  | "self_message"
  | "not_mentioned_and_inactive"
  | "not_thread_owner"
  | "mention_required_in_multi_bot_thread"
  | "empty_text";

export type InboundDecision =
  | { kind: "ignore"; reason: InboundIgnoreReason }
  | { kind: "stop" }
  | { kind: "message"; text: string };
