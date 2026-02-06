type SlackThreadMessage = {
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  subtype?: string;
};

function formatThreadAuthor(message: SlackThreadMessage): string {
  if (message.user) return `<@${message.user}>`;
  if (message.bot_id) return `bot:${message.bot_id}`;
  if (message.username) return message.username;
  return "unknown";
}

export async function fetchThreadHistoryByClient(params: {
  client: {
    conversations: {
      replies: (args: {
        channel: string;
        ts: string;
        limit: number;
        cursor?: string;
        token?: string;
      }) => Promise<{
        messages?: SlackThreadMessage[];
        response_metadata?: { next_cursor?: string };
      }>;
    };
  };
  channelId: string;
  threadId: string;
  messageId: string;
  token?: string;
}): Promise<string | null> {
  const { client, channelId, threadId, messageId, token } = params;

  try {
    const messages: SlackThreadMessage[] = [];
    let cursor: string | undefined;

    do {
      const response = await client.conversations.replies({
        channel: channelId,
        ts: threadId,
        limit: 200,
        cursor,
        token,
      });

      const batch = response.messages;
      if (batch?.length) {
        messages.push(...batch);
      }

      cursor = response.response_metadata?.next_cursor || undefined;
    } while (cursor);

    const history = messages
      .filter((message) => message.ts && message.ts !== messageId)
      .filter((message) => typeof message.text === "string" && message.text.trim().length > 0)
      .map((message) => `${formatThreadAuthor(message)}: ${message.text}`);

    if (history.length === 0) {
      return null;
    }

    return history.join("\n");
  } catch {
    return null;
  }
}
