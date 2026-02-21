import type { SessionEvent } from "@/config/local/redis";

export function collapseTextDeltas(events: SessionEvent[]): SessionEvent[] {
  const result: SessionEvent[] = [];
  const textPartIndices = new Map<string, number>();

  for (const event of events) {
    const eventType = event.type || (event.data as { type?: string } | undefined)?.type;
    const props = (event.data?.properties || event.data) as Record<string, unknown> | undefined;
    const part = props?.part as Record<string, unknown> | undefined;

    if (eventType === "message.part.updated" && part?.type === "text") {
      const partId = typeof part.id === "string" ? part.id : "";
      if (!partId) {
        result.push(event);
        continue;
      }

      const existingIdx = textPartIndices.get(partId);
      if (existingIdx !== undefined) {
        result[existingIdx] = event;
      } else {
        textPartIndices.set(partId, result.length);
        result.push(event);
      }
      continue;
    }

    result.push(event);
  }

  return result;
}
