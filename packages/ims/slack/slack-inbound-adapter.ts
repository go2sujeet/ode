import { defaultInboundPolicy } from "@/ims/shared/inbound-policy";
import type { InboundAdapter } from "@/ims/shared/inbound-adapter";
import type { InboundDecision } from "@/core/model/inbound-decision";
import type { RawInboundEvent } from "@/core/model/raw-inbound-event";

export class SlackInboundAdapter implements InboundAdapter {
  evaluate(event: RawInboundEvent): InboundDecision {
    return defaultInboundPolicy({
      selfMessage: event.selfMessage,
      threadOwnerMessage: event.threadOwnerMessage,
      threadParticipantBotCount: event.threadParticipantBotCount,
      isTopLevel: event.isTopLevel,
      mentionedBot: event.mentionedBot,
      activeThread: event.activeThread,
      normalizedText: event.normalizedText,
    });
  }
}
