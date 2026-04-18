import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadOdeConfig } from "./ode-store";

// ---------------------------------------------------------------------------
// One-time scheduled "Task" storage.
//
// Conceptually a Task is a one-shot cron job: it carries a prompt to send to
// an agent at a specific absolute timestamp. Tasks are particularly useful
// for agents themselves — instead of blocking on a long wait, an agent can
// schedule a Task and return, letting the scheduler resume the conversation
// later.
//
// Storage mirrors `cron-jobs.ts` (shared SQLite DB at ~/.config/ode/inbox.db)
// so persistence, WAL, and test helpers stay consistent across the codebase.
// ---------------------------------------------------------------------------

export type TaskPlatform = "slack" | "discord" | "lark";
export type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export type TaskRecord = {
  id: string;
  title: string;
  scheduledAt: number; // unix ms, absolute
  platform: TaskPlatform;
  workspaceId: string | null;
  workspaceName: string | null;
  channelId: string;
  channelName: string | null;
  /**
   * Optional thread anchor. When set, the scheduler reuses the existing
   * session (if any) for (channelId, threadId) so the agent keeps context.
   * When null, the task posts as a fresh channel message with its own
   * synthetic thread id (`task:{id}`).
   */
  threadId: string | null;
  messageText: string;
  /**
   * Optional agent provider override (e.g. "opencode", "claudecode"). When
   * null the scheduler uses the channel default resolved by the agent
   * adapter. Stored verbatim for audit; the scheduler is responsible for
   * validating the value.
   */
  agent: string | null;
  status: TaskStatus;
  lastError: string | null;
  triggeredAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type TaskChannelOption = {
  value: string;
  platform: TaskPlatform;
  workspaceId: string;
  workspaceName: string;
  channelId: string;
  channelName: string;
  label: string;
};

export type CreateTaskParams = {
  title: string;
  scheduledAt: number;
  channelId: string;
  threadId?: string | null;
  messageText: string;
  agent?: string | null;
};

export type UpdateTaskParams = {
  title?: string;
  scheduledAt?: number;
  channelId?: string;
  threadId?: string | null;
  messageText?: string;
  agent?: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  scheduled_at: number;
  platform: TaskPlatform;
  workspace_id: string | null;
  workspace_name: string | null;
  channel_id: string;
  channel_name: string | null;
  thread_id: string | null;
  message_text: string;
  agent: string | null;
  status: TaskStatus;
  last_error: string | null;
  triggered_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
};

const existsSync = fs.existsSync;
const mkdirSync = fs.mkdirSync;
const join = typeof path.join === "function" ? path.join : (...parts: string[]) => parts.join("/");
const homedir = typeof os.homedir === "function" ? os.homedir : () => "";

const ODE_CONFIG_DIR = join(homedir(), ".config", "ode");
const DEFAULT_DB_FILE = join(ODE_CONFIG_DIR, "inbox.db");

let cachedDatabase: { path: string; db: Database } | null = null;

function resolveDbFile(): string {
  const override = process.env.ODE_INBOX_DB_FILE?.trim();
  return override && override.length > 0 ? override : DEFAULT_DB_FILE;
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function initializeDatabase(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      platform TEXT NOT NULL,
      workspace_id TEXT,
      workspace_name TEXT,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      thread_id TEXT,
      message_text TEXT NOT NULL,
      agent TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      triggered_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status_scheduled ON tasks(status, scheduled_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel_id, scheduled_at DESC);");
}

function getDatabase(): Database {
  const filePath = resolveDbFile();
  if (cachedDatabase?.path === filePath) {
    return cachedDatabase.db;
  }

  if (cachedDatabase) {
    try {
      cachedDatabase.db.close();
    } catch {
      // Ignore close errors on path switch.
    }
  }

  ensureParentDir(filePath);
  const db = new Database(filePath);
  initializeDatabase(db);
  cachedDatabase = { path: filePath, db };
  return db;
}

function mapRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    scheduledAt: row.scheduled_at,
    platform: row.platform,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    channelId: row.channel_id,
    channelName: row.channel_name,
    threadId: row.thread_id,
    messageText: row.message_text,
    agent: row.agent,
    status: row.status,
    lastError: row.last_error,
    triggeredAt: row.triggered_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveConfigChannelId(channelId: string): string {
  const trimmed = channelId.trim();
  if (!trimmed) return trimmed;
  const delimiter = "::";
  const index = trimmed.lastIndexOf(delimiter);
  if (index < 0) return trimmed;
  const raw = trimmed.slice(index + delimiter.length).trim();
  return raw || trimmed;
}

function getChannelSnapshot(channelId: string): {
  platform: TaskPlatform;
  workspaceId: string;
  workspaceName: string;
  channelId: string;
  channelName: string;
} {
  const resolvedChannelId = resolveConfigChannelId(channelId);
  const config = loadOdeConfig();
  for (const workspace of config.workspaces) {
    const channel = workspace.channelDetails.find((item) => item.id === resolvedChannelId);
    if (!channel) continue;
    return {
      platform: workspace.type,
      workspaceId: workspace.id,
      workspaceName: workspace.name || workspace.id,
      channelId: channel.id,
      channelName: channel.name || channel.id,
    };
  }
  throw new Error("Channel not found in configured workspaces");
}

function normalizeTitle(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Task title is required");
  }
  return normalized;
}

function normalizeMessageText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Task message is required");
  }
  return normalized;
}

function normalizeScheduledAt(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Task scheduledAt must be a finite number");
  }
  // Accept seconds *or* milliseconds. Anything below 10^12 is treated as
  // seconds (timestamps before year 33658 in seconds < 10^12 ms cutoff).
  const normalized = value < 1e12 ? Math.floor(value * 1000) : Math.floor(value);
  if (normalized <= 0) {
    throw new Error("Task scheduledAt must be a positive timestamp");
  }
  return normalized;
}

function normalizeThreadId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAgent(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function listTaskChannelOptions(): TaskChannelOption[] {
  const config = loadOdeConfig();
  return config.workspaces.flatMap((workspace) =>
    workspace.channelDetails.map((channel) => ({
      value: `${workspace.id}::${channel.id}`,
      platform: workspace.type,
      workspaceId: workspace.id,
      workspaceName: workspace.name || workspace.id,
      channelId: channel.id,
      channelName: channel.name || channel.id,
      label: `${workspace.name || workspace.id} / ${channel.name || channel.id}`,
    }))
  );
}

export function listTasks(): TaskRecord[] {
  const db = getDatabase();
  const rows = db.query(`
    SELECT *
    FROM tasks
    ORDER BY
      CASE status
        WHEN 'running' THEN 0
        WHEN 'pending' THEN 1
        ELSE 2
      END,
      scheduled_at ASC,
      created_at DESC
  `).all() as TaskRow[];
  return rows.map(mapRow);
}

/**
 * Return tasks that are candidates for the scheduler tick: pending rows whose
 * scheduled time is at or before `nowMs`. Callers still need to race the
 * atomic `markTaskTriggered` before actually running the task.
 */
export function listDueTasks(nowMs: number = Date.now()): TaskRecord[] {
  const db = getDatabase();
  const rows = db.query(`
    SELECT *
    FROM tasks
    WHERE status = 'pending'
      AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
  `).all(nowMs) as TaskRow[];
  return rows.map(mapRow);
}

export function getTaskById(id: string): TaskRecord | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | null;
  return row ? mapRow(row) : null;
}

export function createTask(params: CreateTaskParams): TaskRecord {
  const db = getDatabase();
  const channel = getChannelSnapshot(params.channelId);
  const now = Date.now();
  const id = crypto.randomUUID();
  const title = normalizeTitle(params.title);
  const scheduledAt = normalizeScheduledAt(params.scheduledAt);
  const messageText = normalizeMessageText(params.messageText);
  const threadId = normalizeThreadId(params.threadId);
  const agent = normalizeAgent(params.agent);

  db.query(`
    INSERT INTO tasks (
      id,
      title,
      scheduled_at,
      platform,
      workspace_id,
      workspace_name,
      channel_id,
      channel_name,
      thread_id,
      message_text,
      agent,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    title,
    scheduledAt,
    channel.platform,
    channel.workspaceId,
    channel.workspaceName,
    channel.channelId,
    channel.channelName,
    threadId,
    messageText,
    agent,
    now,
    now
  );

  return getTaskById(id)!;
}

export function updateTask(id: string, params: UpdateTaskParams): TaskRecord {
  const existing = getTaskById(id);
  if (!existing) {
    throw new Error("Task not found");
  }
  if (existing.status !== "pending") {
    throw new Error("Only pending tasks can be updated");
  }

  const db = getDatabase();
  const now = Date.now();

  const title = params.title !== undefined ? normalizeTitle(params.title) : existing.title;
  const scheduledAt = params.scheduledAt !== undefined
    ? normalizeScheduledAt(params.scheduledAt)
    : existing.scheduledAt;
  const messageText = params.messageText !== undefined
    ? normalizeMessageText(params.messageText)
    : existing.messageText;
  const threadId = params.threadId !== undefined
    ? normalizeThreadId(params.threadId)
    : existing.threadId;
  const agent = params.agent !== undefined ? normalizeAgent(params.agent) : existing.agent;

  let channelSnapshot = {
    platform: existing.platform,
    workspaceId: existing.workspaceId ?? "",
    workspaceName: existing.workspaceName ?? "",
    channelId: existing.channelId,
    channelName: existing.channelName ?? "",
  };
  if (params.channelId !== undefined) {
    channelSnapshot = getChannelSnapshot(params.channelId);
  }

  db.query(`
    UPDATE tasks
    SET
      title = ?,
      scheduled_at = ?,
      platform = ?,
      workspace_id = ?,
      workspace_name = ?,
      channel_id = ?,
      channel_name = ?,
      thread_id = ?,
      message_text = ?,
      agent = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    title,
    scheduledAt,
    channelSnapshot.platform,
    channelSnapshot.workspaceId || null,
    channelSnapshot.workspaceName || null,
    channelSnapshot.channelId,
    channelSnapshot.channelName || null,
    threadId,
    messageText,
    agent,
    now,
    id
  );

  return getTaskById(id)!;
}

export function deleteTask(id: string): void {
  const db = getDatabase();
  db.query("DELETE FROM tasks WHERE id = ?").run(id);
}

/**
 * Atomically claim a pending task for execution. Returns true if this caller
 * won the race; false if another scheduler tick (or a manual trigger) got
 * there first. This is the cross-process idempotency key.
 */
export function markTaskTriggered(id: string): boolean {
  const db = getDatabase();
  const now = Date.now();
  const result = db.query(`
    UPDATE tasks
    SET
      status = 'running',
      triggered_at = ?,
      last_error = NULL,
      updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(now, now, id);
  return result.changes > 0;
}

export function markTaskCompleted(id: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.query(`
    UPDATE tasks
    SET
      status = 'success',
      completed_at = ?,
      last_error = NULL,
      updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
}

export function markTaskFailed(id: string, errorMessage: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.query(`
    UPDATE tasks
    SET
      status = 'failed',
      last_error = ?,
      completed_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(errorMessage, now, now, id);
}

/**
 * Cancel a pending task. Returns true if the task was cancellable (was
 * pending). Returns false if the task was already running / finished /
 * cancelled / missing — callers can treat that as a no-op.
 */
export function cancelTask(id: string): boolean {
  const db = getDatabase();
  const now = Date.now();
  const result = db.query(`
    UPDATE tasks
    SET
      status = 'cancelled',
      updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(now, id);
  return result.changes > 0;
}

export function clearTasksForTests(): void {
  const db = getDatabase();
  db.exec("DELETE FROM tasks;");
}

export function closeTaskDatabaseForTests(): void {
  if (!cachedDatabase) return;
  try {
    cachedDatabase.db.close();
  } catch {
    // Ignore close errors in tests.
  } finally {
    cachedDatabase = null;
  }
}
