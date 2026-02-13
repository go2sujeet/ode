import { afterEach, describe, expect, it, mock } from "bun:test";
import { rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleDiscordActionPayload } from "./api";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.DISCORD_BOT_TOKEN;
  mock.restore();
});

describe("handleDiscordActionPayload", () => {
  it("returns validation error when token is missing", async () => {
    const result = await handleDiscordActionPayload({ action: "get_guilds" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Discord bot token missing");
  });

  it("posts a message via Discord API", async () => {
    process.env.DISCORD_BOT_TOKEN = "token";
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({ id: "m1", channel_id: "c1", content: "hello" }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await handleDiscordActionPayload({
      action: "post_message",
      channelId: "c1",
      text: "hello",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ messageId: "m1", channelId: "c1", content: "hello" });
  });

  it("adds a reaction via Discord API", async () => {
    process.env.DISCORD_BOT_TOKEN = "token";
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleDiscordActionPayload({
      action: "add_reaction",
      channelId: "c1",
      messageId: "m1",
      emoji: "thumbsup",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ status: "reaction_added" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches user info via Discord API", async () => {
    process.env.DISCORD_BOT_TOKEN = "token";
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({ id: "u1", username: "tester", global_name: "Test User", bot: false }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await handleDiscordActionPayload({
      action: "get_user_info",
      userId: "<@u1>",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ id: "u1", username: "tester", global_name: "Test User", bot: false });
  });

  it("fetches current bot user info with @me", async () => {
    process.env.DISCORD_BOT_TOKEN = "token";
    const fetchMock = mock(async (url: string) => {
      expect(url).toContain("/users/@me");
      return new Response(
        JSON.stringify({ id: "bot1", username: "ode-bot", bot: true }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleDiscordActionPayload({
      action: "get_user_info",
      userId: "@me",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ id: "bot1", username: "ode-bot", bot: true });
  });

  it("uploads a file via Discord API", async () => {
    process.env.DISCORD_BOT_TOKEN = "token";
    const tempFilePath = join(tmpdir(), `ode-discord-upload-${Date.now()}.txt`);
    await Bun.write(tempFilePath, "hello file");

    try {
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            id: "m-upload",
            channel_id: "c1",
            attachments: [{ id: "a1", filename: "sample.txt", url: "https://cdn.example/file.txt" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as unknown as typeof fetch;

      const result = await handleDiscordActionPayload({
        action: "upload_file",
        channelId: "c1",
        filePath: tempFilePath,
        filename: "sample.txt",
        initialComment: "file uploaded",
      });

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({
        status: "file_uploaded",
        messageId: "m-upload",
        channelId: "c1",
        attachments: [{ id: "a1", filename: "sample.txt", url: "https://cdn.example/file.txt" }],
      });
    } finally {
      rmSync(tempFilePath, { force: true });
    }
  });
});
