import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  clearInboxRecordsForTests,
  closeInboxDatabaseForTests,
  completeInboxRecord,
  createInboxRecordId,
  getInboxPage,
  getInboxRecordById,
  recordInboxRequest,
} from "@/config/local/inbox";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ode-inbox-test-"));
const inboxDbFile = path.join(tempDir, "inbox.db");

describe("local inbox store", () => {
  beforeAll(() => {
    process.env.ODE_INBOX_DB_FILE = inboxDbFile;
  });

  beforeEach(() => {
    clearInboxRecordsForTests();
  });

  afterAll(() => {
    closeInboxDatabaseForTests();
    delete process.env.ODE_INBOX_DB_FILE;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores a request, paginates it, and returns full detail", () => {
    const id = createInboxRecordId({
      channelId: "C-inbox",
      threadId: "T-inbox",
      messageId: "M-inbox",
    });

    recordInboxRequest({
      id,
      platform: "slack",
      channelId: "C-inbox",
      rawChannelId: "workspace-1::C-inbox",
      threadId: "T-inbox",
      replyThreadId: "T-inbox",
      sessionId: "session-inbox",
      userId: "U-inbox",
      messageId: "M-inbox",
      providerId: "codex",
      model: "openai/gpt-5.4",
      workingDirectory: "/tmp/ode-inbox",
      promptText: "Please summarize the release notes and list the most important changes.",
      context: {
        isFirstMessageInThread: true,
        hasThreadHistory: false,
      },
    });

    completeInboxRecord({
      id,
      resultText: "Summary: feature A shipped, feature B changed behavior, and feature C was removed.",
      sessionId: "session-inbox",
      providerId: "codex",
      model: "openai/gpt-5.4",
      workingDirectory: "/tmp/ode-inbox",
    });

    const page = getInboxPage({ page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(id);
    expect(page.items[0]?.status).toBe("completed");
    expect(page.items[0]?.providerId).toBe("codex");
    expect(page.items[0]?.model).toBe("openai/gpt-5.4");
    expect(page.items[0]?.resultSummary?.includes("feature A shipped")).toBe(true);

    const detail = getInboxRecordById(id);
    expect(detail).not.toBeNull();
    expect(detail?.promptText).toContain("release notes");
    expect(detail?.resultText).toContain("feature C was removed");
    expect(detail?.context?.isFirstMessageInThread).toBe(true);
  });
});
