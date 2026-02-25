import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { deleteSession, loadSession } from "@/config/local/sessions";

const SESSIONS_DIR = path.join(os.homedir(), ".config", "ode", "sessions");

function getSessionFilePath(channelId: string, threadId: string): string {
  const sessionKey = `${channelId}-${threadId}`;
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9-]/g, "_");
  return path.join(SESSIONS_DIR, `${safeKey}.json`);
}

function writeSessionFixture(params: {
  channelId: string;
  threadId: string;
  createdAt: number;
  lastActivityAt: number;
}): string {
  const { channelId, threadId, createdAt, lastActivityAt } = params;
  const filePath = getSessionFilePath(channelId, threadId);
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    sessionId: `session-${threadId}`,
    channelId,
    threadId,
    workingDirectory: "/tmp",
    createdAt,
    lastActivityAt,
  }, null, 2));
  return filePath;
}

describe("session retention", () => {
  it("deletes session file when lastActivityAt is older than one week", () => {
    const channelId = "RETENTION-C1";
    const threadId = "RETENTION-T1";
    const now = Date.now();
    const staleAt = now - 8 * 24 * 60 * 60 * 1000;
    const filePath = writeSessionFixture({
      channelId,
      threadId,
      createdAt: staleAt,
      lastActivityAt: staleAt,
    });

    expect(fs.existsSync(filePath)).toBeTrue();
    expect(loadSession(channelId, threadId)).toBeNull();
    expect(fs.existsSync(filePath)).toBeFalse();

    deleteSession(channelId, threadId);
  });

  it("keeps session file when lastActivityAt is within one week", () => {
    const channelId = "RETENTION-C2";
    const threadId = "RETENTION-T2";
    const now = Date.now();
    const recentAt = now - 2 * 24 * 60 * 60 * 1000;
    const filePath = writeSessionFixture({
      channelId,
      threadId,
      createdAt: recentAt,
      lastActivityAt: recentAt,
    });

    const loaded = loadSession(channelId, threadId);
    expect(loaded).not.toBeNull();
    expect(fs.existsSync(filePath)).toBeTrue();

    deleteSession(channelId, threadId);
  });
});
