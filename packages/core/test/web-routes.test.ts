import { afterAll, describe, expect, it } from "bun:test";
import type { SessionEvent } from "@/config/local/redis";
import {
  clearInboxRecordsForTests,
  closeInboxDatabaseForTests,
  createInboxRecordId,
  recordInboxRequest,
} from "@/config/local/inbox";
import { createWebApp } from "@/core/web/app";
import { collapseTextDeltas } from "@/core/web/session-events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ode-web-inbox-test-"));
process.env.ODE_INBOX_DB_FILE = path.join(tempDir, "inbox.db");

describe("web app routing", () => {
  it("redirects /local-setting to root", async () => {
    const app = createWebApp();
    const response = await app.handle(new Request("http://localhost/local-setting"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/");
  });

  it("redirects /local-setting/* to root-relative path", async () => {
    const app = createWebApp();
    const response = await app.handle(new Request("http://localhost/local-setting/sessions/abc"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/sessions/abc");
  });

  it("returns 400 for workspace sync without workspaceId", async () => {
    const app = createWebApp();
    const response = await app.handle(new Request("http://localhost/api/slack-sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);
    const payload = await response.json() as { ok: boolean; error?: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("Missing workspaceId");
  });

  it("returns 400 for workspace discover without required credentials", async () => {
    const app = createWebApp();
    const response = await app.handle(new Request("http://localhost/api/slack-discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }));

    expect(response.status).toBe(400);
    const payload = await response.json() as { ok: boolean; error?: string };
    expect(payload.ok).toBe(false);
    expect(payload.error?.startsWith("Missing Slack")).toBe(true);
  });

  it("returns paginated inbox records and record detail", async () => {
    clearInboxRecordsForTests();
    const inboxId = createInboxRecordId({
      channelId: "C-web",
      threadId: "T-web",
      messageId: "M-web",
    });
    recordInboxRequest({
      id: inboxId,
      platform: "slack",
      channelId: "C-web",
      threadId: "T-web",
      replyThreadId: "T-web",
      promptText: "show me the latest build failures",
      providerId: "opencode",
    });

    const app = createWebApp();
    const listResponse = await app.handle(new Request("http://localhost/api/inbox?page=1&pageSize=5"));
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json() as {
      ok: boolean;
      result?: {
        total: number;
        items: Array<{ id: string; promptSummary: string }>;
      };
    };
    expect(listPayload.ok).toBe(true);
    expect(listPayload.result?.total).toBe(1);
    expect(listPayload.result?.items[0]?.id).toBe(inboxId);
    expect(listPayload.result?.items[0]?.promptSummary).toContain("latest build failures");

    const detailResponse = await app.handle(new Request(`http://localhost/api/inbox/${encodeURIComponent(inboxId)}`));
    expect(detailResponse.status).toBe(200);
    const detailPayload = await detailResponse.json() as {
      ok: boolean;
      result?: { id: string; promptText: string };
    };
    expect(detailPayload.ok).toBe(true);
    expect(detailPayload.result?.id).toBe(inboxId);
    expect(detailPayload.result?.promptText).toBe("show me the latest build failures");
  });
});

describe("collapseTextDeltas", () => {
  it("keeps only latest text delta for each part id", () => {
    const base = {
      sessionId: "s1",
      channelId: "C1",
      threadId: "T1",
      agentProvider: "opencode",
    };
    const events = [
      {
        ...base,
        timestamp: 1,
        type: "message.part.updated",
        data: { properties: { part: { id: "p1", type: "text", text: "a" } } },
      },
      {
        ...base,
        timestamp: 2,
        type: "message.part.updated",
        data: { properties: { part: { id: "p1", type: "text", text: "ab" } } },
      },
      {
        ...base,
        timestamp: 3,
        type: "tool.started",
        data: { id: "t1" },
      },
      {
        ...base,
        timestamp: 4,
        type: "message.part.updated",
        data: { properties: { part: { id: "p2", type: "text", text: "x" } } },
      },
    ] as SessionEvent[];

    const collapsed = collapseTextDeltas(events);
    expect(collapsed).toHaveLength(3);
    expect(collapsed[0]?.timestamp).toBe(2);
    expect(collapsed[1]?.type).toBe("tool.started");
    expect(collapsed[2]?.timestamp).toBe(4);
  });
});

afterAll(() => {
  closeInboxDatabaseForTests();
  delete process.env.ODE_INBOX_DB_FILE;
  fs.rmSync(tempDir, { recursive: true, force: true });
});
