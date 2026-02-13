import { basename } from "path";

export type DiscordActionName =
  | "get_guilds"
  | "get_channels"
  | "post_message"
  | "update_message"
  | "create_thread_from_message"
  | "get_thread_messages"
  | "ask_user"
  | "add_reaction"
  | "get_user_info"
  | "upload_file";

export type DiscordActionRequest = {
  action: DiscordActionName;
  botToken?: string;
  guildId?: string;
  channelId?: string;
  threadId?: string;
  messageId?: string;
  name?: string;
  text?: string;
  emoji?: string;
  question?: string;
  options?: unknown[];
  userId?: string;
  filePath?: string;
  filename?: string;
  title?: string;
  initialComment?: string;
  limit?: number;
  autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
};

export type DiscordApiResponse = {
  ok: boolean;
  result?: unknown;
  error?: string;
};

function requireString(value: unknown, label: string): string {
  if (!value || typeof value !== "string") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function normalizeOptionLabel(option: unknown): string {
  if (typeof option === "string") return option;
  if (option && typeof option === "object") {
    const record = option as Record<string, unknown>;
    if (typeof record.label === "string") return record.label;
    if (typeof record.text === "string") return record.text;
    if (typeof record.value === "string") return record.value;
  }
  return String(option ?? "");
}

const REACTION_ALIASES: Record<string, string> = {
  thumbup: "thumbsup",
  ok: "ok_hand",
};

const DISCORD_REACTIONS: Record<string, string> = {
  thumbsup: "👍",
  eyes: "👀",
  ok_hand: "👌",
};

function normalizeDiscordEmoji(emoji: string): string {
  const trimmed = emoji.trim();
  if (!trimmed) {
    throw new Error("emoji is required");
  }
  const stripped = trimmed.replace(/^:+|:+$/g, "").replace(/:/g, "");
  const normalized = REACTION_ALIASES[stripped] ?? stripped;
  const resolved = DISCORD_REACTIONS[normalized] ?? normalized;
  if (!["👍", "👀", "👌"].includes(resolved)) {
    throw new Error("emoji must be one of: thumbsup, eyes, ok_hand");
  }
  return resolved;
}

function normalizeDiscordUserId(userId: string): string {
  const trimmed = userId.trim();
  if (trimmed === "@me" || trimmed.toLowerCase() === "me") {
    return "@me";
  }
  if ((trimmed.startsWith("<@") || trimmed.startsWith("<@!")) && trimmed.endsWith(">")) {
    return trimmed.replace(/^<@!?/, "").slice(0, -1);
  }
  return trimmed;
}

function getDiscordBotToken(payload: DiscordActionRequest): string {
  const token = payload.botToken?.trim() || process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("Discord bot token missing (set payload.botToken or DISCORD_BOT_TOKEN)");
  }
  return token;
}

async function discordApiCall<T>(
  token: string,
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errorBody = await response.json() as { message?: string; code?: number };
      detail = errorBody.message ? `: ${errorBody.message}` : "";
    } catch {
      // noop
    }
    throw new Error(`Discord API ${response.status} ${response.statusText}${detail}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function discordMultipartCall<T>(
  token: string,
  method: "POST",
  path: string,
  formData: FormData
): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const errorBody = await response.json() as { message?: string; code?: number };
      detail = errorBody.message ? `: ${errorBody.message}` : "";
    } catch {
      // noop
    }
    throw new Error(`Discord API ${response.status} ${response.statusText}${detail}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function handleDiscordAction(payload: DiscordActionRequest): Promise<unknown> {
  const token = getDiscordBotToken(payload);

  switch (payload.action) {
    case "get_guilds": {
      const guilds = await discordApiCall<Array<{
        id: string;
        name: string;
        owner?: boolean;
      }>>(token, "GET", "/users/@me/guilds");
      return { guilds };
    }

    case "get_channels": {
      const guildId = requireString(payload.guildId, "guildId");
      const channels = await discordApiCall<Array<{
        id: string;
        type: number;
        name?: string;
        parent_id?: string | null;
      }>>(token, "GET", `/guilds/${guildId}/channels`);
      return { channels };
    }

    case "post_message": {
      const channelId = requireString(payload.channelId, "channelId");
      const text = requireString(payload.text, "text");
      const message = await discordApiCall<{ id: string; channel_id: string; content: string }>(
        token,
        "POST",
        `/channels/${channelId}/messages`,
        { content: text }
      );
      return {
        messageId: message.id,
        channelId: message.channel_id,
        content: message.content,
      };
    }

    case "update_message": {
      const channelId = requireString(payload.channelId, "channelId");
      const messageId = requireString(payload.messageId, "messageId");
      const text = requireString(payload.text, "text");
      const message = await discordApiCall<{ id: string; channel_id: string; content: string }>(
        token,
        "PATCH",
        `/channels/${channelId}/messages/${messageId}`,
        { content: text }
      );
      return {
        messageId: message.id,
        channelId: message.channel_id,
        content: message.content,
      };
    }

    case "create_thread_from_message": {
      const channelId = requireString(payload.channelId, "channelId");
      const messageId = requireString(payload.messageId, "messageId");
      const name = requireString(payload.name, "name");
      const thread = await discordApiCall<{ id: string; parent_id: string; name: string; type: number }>(
        token,
        "POST",
        `/channels/${channelId}/messages/${messageId}/threads`,
        {
          name,
          ...(payload.autoArchiveDuration ? { auto_archive_duration: payload.autoArchiveDuration } : {}),
        }
      );
      return {
        threadId: thread.id,
        parentId: thread.parent_id,
        name: thread.name,
        type: thread.type,
      };
    }

    case "get_thread_messages": {
      const threadId = requireString(payload.threadId, "threadId");
      const limit = Math.min(Math.max(payload.limit ?? 20, 1), 100);
      const messages = await discordApiCall<Array<{ id: string; content: string; author?: { username?: string } }>>(
        token,
        "GET",
        `/channels/${threadId}/messages?limit=${limit}`
      );
      return { messages };
    }

    case "ask_user": {
      const channelId = requireString(payload.channelId, "channelId");
      const question = requireString(payload.question, "question");
      const options = Array.isArray(payload.options)
        ? payload.options.map(normalizeOptionLabel).filter((opt) => opt.trim().length > 0)
        : [];
      if (options.length < 2 || options.length > 5) {
        throw new Error("options must have 2-5 items");
      }

      const optionLines = options.map((option, index) => `${index + 1}. ${option}`).join("\n");
      const prompt = `${question}\n\nOptions:\n${optionLines}\n\nReply with the option text or number.`;

      const message = await discordApiCall<{ id: string; channel_id: string; content: string }>(
        token,
        "POST",
        `/channels/${channelId}/messages`,
        { content: prompt }
      );

      return {
        status: "question_posted",
        messageId: message.id,
        channelId: message.channel_id,
      };
    }

    case "add_reaction": {
      const channelId = requireString(payload.channelId, "channelId");
      const messageId = requireString(payload.messageId, "messageId");
      const emoji = normalizeDiscordEmoji(requireString(payload.emoji, "emoji"));

      await discordApiCall<void>(
        token,
        "PUT",
        `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`
      );

      return { status: "reaction_added" };
    }

    case "get_user_info": {
      const userId = normalizeDiscordUserId(requireString(payload.userId, "userId"));
      const userPath = userId === "@me" ? "/users/@me" : `/users/${userId}`;
      const user = await discordApiCall<{
        id: string;
        username: string;
        global_name?: string | null;
        bot?: boolean;
      }>(token, "GET", userPath);
      return user;
    }

    case "upload_file": {
      const channelId = requireString(payload.channelId, "channelId");
      const filePath = requireString(payload.filePath, "filePath");
      const filename = payload.filename?.trim() || basename(filePath);
      const initialComment = payload.initialComment?.trim();

      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        throw new Error(`File not found: ${filePath}`);
      }

      const formData = new FormData();
      formData.append("files[0]", file, filename);
      formData.append("payload_json", JSON.stringify({
        content: initialComment && initialComment.length > 0 ? initialComment : undefined,
      }));

      const message = await discordMultipartCall<{
        id: string;
        channel_id: string;
        attachments?: Array<{ id: string; filename: string; url: string }>;
      }>(
        token,
        "POST",
        `/channels/${channelId}/messages`,
        formData
      );

      return {
        status: "file_uploaded",
        messageId: message.id,
        channelId: message.channel_id,
        attachments: message.attachments ?? [],
      };
    }

    default:
      throw new Error(`Unknown Discord action: ${payload.action}`);
  }
}

export async function handleDiscordActionPayload(payload: unknown): Promise<DiscordApiResponse> {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid payload" };
  }

  try {
    const result = await handleDiscordAction(payload as DiscordActionRequest);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
