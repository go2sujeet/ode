import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { invalidateOdeConfigCache, ODE_CONFIG_FILE } from "./ode-store";
import {
  cancelTask,
  clearTasksForTests,
  closeTaskDatabaseForTests,
  createTask,
  deleteTask,
  getTaskById,
  listDueTasks,
  listTasks,
  markTaskCompleted,
  markTaskFailed,
  markTaskTriggered,
  updateTask,
} from "./tasks";

// We reuse the real `~/.config/ode/ode.json` path (resolved at module load)
// but swap its contents for test fixtures and restore them on teardown.
// The inbox SQLite DB is redirected to a temp dir via ODE_INBOX_DB_FILE so
// test data never touches the user's real inbox.db.
let tempDir: string;
let originalConfigEnv: string | undefined;
let originalConfigContent: string | null;
let originalConfigExisted: boolean;

function writeTestOdeConfig(): void {
  const config = {
    user: {},
    workspaces: [
      {
        id: "ws-test",
        name: "Test Workspace",
        type: "slack",
        channelDetails: [
          { id: "C_TEST", name: "general" },
          { id: "C_OTHER", name: "random" },
        ],
      },
    ],
  };
  fs.mkdirSync(path.dirname(ODE_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(ODE_CONFIG_FILE, JSON.stringify(config));
  invalidateOdeConfigCache();
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ode-tasks-test-"));
  originalConfigEnv = process.env.ODE_INBOX_DB_FILE;
  process.env.ODE_INBOX_DB_FILE = path.join(tempDir, "inbox.db");

  originalConfigExisted = fs.existsSync(ODE_CONFIG_FILE);
  originalConfigContent = originalConfigExisted ? fs.readFileSync(ODE_CONFIG_FILE, "utf-8") : null;
  writeTestOdeConfig();

  closeTaskDatabaseForTests();
  clearTasksForTests();
});

afterEach(() => {
  closeTaskDatabaseForTests();
  if (originalConfigEnv === undefined) {
    delete process.env.ODE_INBOX_DB_FILE;
  } else {
    process.env.ODE_INBOX_DB_FILE = originalConfigEnv;
  }

  // Restore the real ode.json so the user's config isn't left in a test state.
  try {
    if (originalConfigExisted && originalConfigContent !== null) {
      fs.writeFileSync(ODE_CONFIG_FILE, originalConfigContent);
    } else {
      fs.rmSync(ODE_CONFIG_FILE, { force: true });
    }
  } catch {
    // Best effort.
  }
  invalidateOdeConfigCache();

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
});

describe("tasks storage", () => {
  test("createTask persists fields and resolves channel snapshot", () => {
    const scheduledAt = Date.now() + 60_000;
    const task = createTask({
      title: "Check deploy",
      scheduledAt,
      channelId: "C_TEST",
      threadId: "1234.5678",
      messageText: "Check deployment status",
      agent: "opencode",
    });

    expect(task.id).toBeTruthy();
    expect(task.title).toBe("Check deploy");
    expect(task.scheduledAt).toBe(scheduledAt);
    expect(task.platform).toBe("slack");
    expect(task.workspaceId).toBe("ws-test");
    expect(task.workspaceName).toBe("Test Workspace");
    expect(task.channelId).toBe("C_TEST");
    expect(task.channelName).toBe("general");
    expect(task.threadId).toBe("1234.5678");
    expect(task.agent).toBe("opencode");
    expect(task.status).toBe("pending");
    expect(task.lastError).toBeNull();
  });

  test("createTask rejects unknown channel", () => {
    expect(() =>
      createTask({
        title: "x",
        scheduledAt: Date.now() + 1000,
        channelId: "C_UNKNOWN",
        messageText: "hi",
      }),
    ).toThrow(/Channel not found/);
  });

  test("createTask normalizes seconds-valued scheduledAt to milliseconds", () => {
    const seconds = Math.floor(Date.now() / 1000) + 60;
    const task = createTask({
      title: "s",
      scheduledAt: seconds,
      channelId: "C_TEST",
      messageText: "hi",
    });
    expect(task.scheduledAt).toBe(seconds * 1000);
  });

  test("listDueTasks returns only pending tasks at or before now", () => {
    const now = Date.now();
    const past = createTask({
      title: "past",
      scheduledAt: now - 10_000,
      channelId: "C_TEST",
      messageText: "a",
    });
    const future = createTask({
      title: "future",
      scheduledAt: now + 60_000,
      channelId: "C_TEST",
      messageText: "b",
    });

    const due = listDueTasks(now);
    expect(due.map((t) => t.id)).toContain(past.id);
    expect(due.map((t) => t.id)).not.toContain(future.id);
  });

  test("markTaskTriggered is atomic: first caller wins, second caller is no-op", () => {
    const task = createTask({
      title: "race",
      scheduledAt: Date.now() - 1000,
      channelId: "C_TEST",
      messageText: "race me",
    });

    const first = markTaskTriggered(task.id);
    const second = markTaskTriggered(task.id);
    expect(first).toBe(true);
    expect(second).toBe(false);

    const updated = getTaskById(task.id);
    expect(updated?.status).toBe("running");
    expect(updated?.triggeredAt).not.toBeNull();
  });

  test("markTaskCompleted and markTaskFailed set terminal status", () => {
    const a = createTask({ title: "ok", scheduledAt: Date.now(), channelId: "C_TEST", messageText: "x" });
    const b = createTask({ title: "err", scheduledAt: Date.now(), channelId: "C_TEST", messageText: "y" });
    markTaskTriggered(a.id);
    markTaskCompleted(a.id);
    markTaskTriggered(b.id);
    markTaskFailed(b.id, "boom");

    expect(getTaskById(a.id)?.status).toBe("success");
    expect(getTaskById(b.id)?.status).toBe("failed");
    expect(getTaskById(b.id)?.lastError).toBe("boom");
  });

  test("cancelTask only cancels pending tasks", () => {
    const task = createTask({ title: "c", scheduledAt: Date.now() + 60_000, channelId: "C_TEST", messageText: "hi" });
    expect(cancelTask(task.id)).toBe(true);
    expect(getTaskById(task.id)?.status).toBe("cancelled");
    // Second cancel is a no-op.
    expect(cancelTask(task.id)).toBe(false);

    // Cannot cancel a running or completed task.
    const running = createTask({ title: "r", scheduledAt: Date.now(), channelId: "C_TEST", messageText: "r" });
    markTaskTriggered(running.id);
    expect(cancelTask(running.id)).toBe(false);
    expect(getTaskById(running.id)?.status).toBe("running");
  });

  test("updateTask rejects edits on non-pending tasks", () => {
    const task = createTask({ title: "u", scheduledAt: Date.now() + 60_000, channelId: "C_TEST", messageText: "hi" });
    markTaskTriggered(task.id);
    expect(() => updateTask(task.id, { title: "nope" })).toThrow(/pending/);
  });

  test("updateTask preserves unspecified fields", () => {
    const task = createTask({
      title: "u2",
      scheduledAt: Date.now() + 60_000,
      channelId: "C_TEST",
      threadId: "T1",
      messageText: "original",
      agent: "opencode",
    });
    const updated = updateTask(task.id, { messageText: "new text" });
    expect(updated.messageText).toBe("new text");
    expect(updated.title).toBe(task.title);
    expect(updated.channelId).toBe("C_TEST");
    expect(updated.threadId).toBe("T1");
    expect(updated.agent).toBe("opencode");
    expect(updated.scheduledAt).toBe(task.scheduledAt);
  });

  test("deleteTask removes the record", () => {
    const task = createTask({ title: "d", scheduledAt: Date.now(), channelId: "C_TEST", messageText: "x" });
    deleteTask(task.id);
    expect(getTaskById(task.id)).toBeNull();
  });

  test("listTasks orders running first, then pending by scheduled time", () => {
    const now = Date.now();
    const later = createTask({ title: "later", scheduledAt: now + 120_000, channelId: "C_TEST", messageText: "l" });
    const sooner = createTask({ title: "sooner", scheduledAt: now + 60_000, channelId: "C_TEST", messageText: "s" });
    const runningTask = createTask({ title: "running", scheduledAt: now, channelId: "C_TEST", messageText: "r" });
    markTaskTriggered(runningTask.id);

    const list = listTasks();
    expect(list[0]?.id).toBe(runningTask.id);
    const pendingOrder = list.filter((t) => t.status === "pending").map((t) => t.id);
    expect(pendingOrder).toEqual([sooner.id, later.id]);
  });
});
