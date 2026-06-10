export async function sendSlackChannelMessage(
  channelId: string,
  text: string,
  processorId?: string
): Promise<string | undefined> {
  const { sendChannelMessage } = await import("@/ims/slack/client");
  return sendChannelMessage(channelId, text, processorId);
}

export async function sendSlackThreadMessage(
  channelId: string,
  threadId: string,
  text: string,
  processorId?: string
): Promise<string | undefined> {
  const { sendMessage } = await import("@/ims/slack/client");
  return sendMessage(channelId, threadId, text, processorId);
}
