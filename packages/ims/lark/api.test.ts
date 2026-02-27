import { afterEach, describe, expect, it, mock } from "bun:test";
import { rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { handleLarkActionPayload } from "./api";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  mock.restore();
});

describe("handleLarkActionPayload", () => {
  it("returns validation error when credentials are missing", async () => {
    const result = await handleLarkActionPayload({ action: "post_message", channelId: "oc_x", text: "hello" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Lark app credentials missing");
  });

  it("posts a message via Lark API", async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      if (url.includes("tenant_access_token")) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      expect(body.msg_type).toBe("post");
      const content = typeof body.content === "string" ? JSON.parse(body.content) as Record<string, unknown> : {};
      const zh = content.zh_cn as { content?: Array<Array<{ tag?: string; text?: string }>> };
      expect(zh.content?.[0]?.[0]?.tag).toBe("md");

      return new Response(
        JSON.stringify({ code: 0, data: { message_id: "om_xxx" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleLarkActionPayload({
      action: "post_message",
      appId: "cli_app",
      appSecret: "secret",
      channelId: "oc_123",
      text: "hello",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ messageId: "om_xxx", channelId: "oc_123" });
  });

  it("posts a thread reply via reply endpoint", async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      if (url.includes("tenant_access_token")) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      expect(url).toContain("/im/v1/messages/om_root/reply");
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      expect(body.msg_type).toBe("post");
      expect(body.reply_in_thread).toBe(true);
      const content = typeof body.content === "string" ? JSON.parse(body.content) as Record<string, unknown> : {};
      const zh = content.zh_cn as { content?: Array<Array<{ tag?: string; text?: string }>> };
      expect(zh.content?.[0]?.[0]?.tag).toBe("md");
      return new Response(
        JSON.stringify({ code: 0, data: { message_id: "om_reply" } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleLarkActionPayload({
      action: "post_message",
      appId: "cli_app",
      appSecret: "secret",
      channelId: "oc_123",
      threadId: "om_root",
      text: "reply",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ messageId: "om_reply", channelId: "oc_123" });
  });

  it("updates a message via Lark API", async () => {
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      if (url.includes("tenant_access_token")) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      expect(init?.method).toBe("PATCH");
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
      expect(body.msg_type).toBe("post");
      return new Response(
        JSON.stringify({ code: 0, data: {} }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleLarkActionPayload({
      action: "update_message",
      appId: "cli_app",
      appSecret: "secret",
      messageId: "om_123",
      text: "updated",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ status: "message_updated", messageId: "om_123" });
  });

  it("adds a reaction via Lark API", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.includes("tenant_access_token")) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ code: 0, data: {} }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleLarkActionPayload({
      action: "add_reaction",
      appId: "cli_app",
      appSecret: "secret",
      messageId: "om_123",
      emoji: "thumbsup",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ status: "reaction_added", messageId: "om_123" });
  });

  it("lists channels via Lark API", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.includes("tenant_access_token")) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ code: 0, data: { items: [{ chat_id: "oc_1", name: "dev" }] } }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleLarkActionPayload({
      action: "get_channels",
      appId: "cli_app",
      appSecret: "secret",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ channels: [{ chat_id: "oc_1", name: "dev" }] });
  });

  it("filters thread messages from chat list", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.includes("tenant_access_token")) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            items: [
              { message_id: "om_root", root_id: "" },
              { message_id: "om_reply", root_id: "om_root" },
              { message_id: "om_other", root_id: "om_other" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleLarkActionPayload({
      action: "get_thread_messages",
      appId: "cli_app",
      appSecret: "secret",
      channelId: "oc_123",
      threadId: "om_root",
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({
      messages: [
        { message_id: "om_root", root_id: "" },
        { message_id: "om_reply", root_id: "om_root" },
      ],
    });
  });

  it("uploads a file via Lark API", async () => {
    const tempFilePath = join(tmpdir(), `ode-lark-upload-${Date.now()}.txt`);
    await Bun.write(tempFilePath, "hello lark file");

    try {
      const fetchMock = mock(async (url: string) => {
        if (url.includes("tenant_access_token")) {
          return new Response(
            JSON.stringify({ code: 0, tenant_access_token: "tenant_token" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url.includes("/im/v1/files")) {
          return new Response(
            JSON.stringify({ code: 0, data: { file_key: "file_xxx" } }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        if (url.includes("/im/v1/messages")) {
          return new Response(
            JSON.stringify({ code: 0, data: { message_id: "om_file" } }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ code: 0, data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await handleLarkActionPayload({
        action: "upload_file",
        appId: "cli_app",
        appSecret: "secret",
        channelId: "oc_123",
        threadId: "om_root",
        filePath: tempFilePath,
        filename: "sample.txt",
        initialComment: "uploading file",
      });

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({
        status: "file_uploaded",
        messageId: "om_file",
        channelId: "oc_123",
        fileKey: "file_xxx",
      });
    } finally {
      rmSync(tempFilePath, { force: true });
    }
  });
});
