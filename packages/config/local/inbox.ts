import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadOdeConfig } from "./ode-store";

export type InboxRecordStatus = "pending" | "completed" | "failed";

export type InboxRecordSummary = {
  id: string;
  status: InboxRecordStatus;
  platform: "slack" | "discord" | "lark";
  workspaceId: string | null;
  workspaceName: string | null;
  channelId: string;
  channelName: string | null;
  rawChannelId: string | null;
  threadId: string;
  replyThreadId: string;
  sessionId: string | null;
  userId: string | null;
  messageId: string | null;
  providerId: string | null;
  model: string | null;
  workingDirectory: string | null;
  promptSummary: string;
  resultSummary: string | null;
  promptLength: number;
  resultLength: number;
  errorText: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type InboxRecordDetail = InboxRecordSummary & {
  promptText: string;
  resultText: string | null;
  context: Record<string, unknown> | null;
};

export type InboxPage = {
  items: InboxRecordSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type CreateInboxRecordParams = {
  id: string;
  platform: "slack" | "discord" | "lark";
  channelId: string;
  rawChannelId?: string;
  threadId: string;
  replyThreadId: string;
  sessionId?: string | null;
  userId?: string | null;
  messageId?: string | null;
  providerId?: string | null;
  model?: string | null;
  workingDirectory?: string | null;
  promptText: string;
  context?: Record<string, unknown> | null;
};

type InboxRow = {
  id: string;
  status: InboxRecordStatus;
  platform: "slack" | "discord" | "lark";
  workspace_id: string | null;
  workspace_name: string | null;
  channel_id: string;
  channel_name: string | null;
  raw_channel_id: string | null;
  thread_id: string;
  reply_thread_id: string;
  session_id: string | null;
  user_id: string | null;
  message_id: string | null;
  provider_id: string | null;
  model: string | null;
  working_directory: string | null;
  prompt_text: string;
  prompt_summary: string;
  result_text: string | null;
  result_summary: string | null;
  context_json: string | null;
  error_text: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

const existsSync = fs.existsSync;
const mkdirSync = fs.mkdirSync;
const join = typeof path.join === "function" ? path.join : (...parts: string[]) => parts.join("/");
const homedir = typeof os.homedir === "function" ? os.homedir : () => "";

const ODE_CONFIG_DIR = join(homedir(), ".config", "ode");
const DEFAULT_INBOX_DB_FILE = join(ODE_CONFIG_DIR, "inbox.db");
const DEFAULT_SUMMARY_LENGTH = 240;

let cachedDatabase: { path: string; db: Database } | null = null;

function resolveInboxDbFile(): string {
  const override = process.env.ODE_INBOX_DB_FILE?.trim();
  return override && override.length > 0 ? override : DEFAULT_INBOX_DB_FILE;
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
    CREATE TABLE IF NOT EXISTS inbox_records (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      platform TEXT NOT NULL,
      workspace_id TEXT,
      workspace_name TEXT,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      raw_channel_id TEXT,
      thread_id TEXT NOT NULL,
      reply_thread_id TEXT NOT NULL,
      session_id TEXT,
      user_id TEXT,
      message_id TEXT,
      provider_id TEXT,
      model TEXT,
      working_directory TEXT,
      prompt_text TEXT NOT NULL,
      prompt_summary TEXT NOT NULL,
      result_text TEXT,
      result_summary TEXT,
      context_json TEXT,
      error_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_inbox_records_created_at ON inbox_records(created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_inbox_records_channel_id ON inbox_records(channel_id, created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_inbox_records_thread_id ON inbox_records(thread_id, created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_inbox_records_status ON inbox_records(status, created_at DESC);");
}

function getDatabase(): Database {
  const filePath = resolveInboxDbFile();
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

function normalizeSummaryText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function createSummary(text: string, maxLength = DEFAULT_SUMMARY_LENGTH): string {
  const normalized = normalizeSummaryText(text);
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeJsonParse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toJsonText(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) return null;
  return JSON.stringify(value);
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

function getWorkspaceChannelSnapshot(channelId: string): {
  workspaceId: string | null;
  workspaceName: string | null;
  channelName: string | null;
} {
  const resolvedChannelId = resolveConfigChannelId(channelId);
  const config = loadOdeConfig();
  for (const workspace of config.workspaces) {
    const channel = workspace.channelDetails.find((item) => item.id === resolvedChannelId);
    if (!channel) continue;
    return {
      workspaceId: workspace.id || null,
      workspaceName: workspace.name || null,
      channelName: channel.name || null,
    };
  }
  return {
    workspaceId: null,
    workspaceName: null,
    channelName: null,
  };
}

function mapSummaryRow(row: InboxRow): InboxRecordSummary {
  return {
    id: row.id,
    status: row.status,
    platform: row.platform,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    channelId: row.channel_id,
    channelName: row.channel_name,
    rawChannelId: row.raw_channel_id,
    threadId: row.thread_id,
    replyThreadId: row.reply_thread_id,
    sessionId: row.session_id,
    userId: row.user_id,
    messageId: row.message_id,
    providerId: row.provider_id,
    model: row.model,
    workingDirectory: row.working_directory,
    promptSummary: row.prompt_summary,
    resultSummary: row.result_summary,
    promptLength: row.prompt_text.length,
    resultLength: row.result_text?.length ?? 0,
    errorText: row.error_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function mapDetailRow(row: InboxRow): InboxRecordDetail {
  return {
    ...mapSummaryRow(row),
    promptText: row.prompt_text,
    resultText: row.result_text,
    context: safeJsonParse(row.context_json),
  };
}

export function createInboxRecordId(params: {
  channelId: string;
  threadId: string;
  messageId: string;
}): string {
  return `${params.channelId}:${params.threadId}:${params.messageId}`;
}

export function recordInboxRequest(params: CreateInboxRecordParams): string {
  const db = getDatabase();
  const now = Date.now();
  const workspace = getWorkspaceChannelSnapshot(params.rawChannelId ?? params.channelId);
  const promptSummary = createSummary(params.promptText);

  db.query(`
    INSERT INTO inbox_records (
      id,
      status,
      platform,
      workspace_id,
      workspace_name,
      channel_id,
      channel_name,
      raw_channel_id,
      thread_id,
      reply_thread_id,
      session_id,
      user_id,
      message_id,
      provider_id,
      model,
      working_directory,
      prompt_text,
      prompt_summary,
      context_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      platform = excluded.platform,
      workspace_id = excluded.workspace_id,
      workspace_name = excluded.workspace_name,
      channel_id = excluded.channel_id,
      channel_name = excluded.channel_name,
      raw_channel_id = excluded.raw_channel_id,
      thread_id = excluded.thread_id,
      reply_thread_id = excluded.reply_thread_id,
      session_id = COALESCE(excluded.session_id, inbox_records.session_id),
      user_id = COALESCE(excluded.user_id, inbox_records.user_id),
      message_id = COALESCE(excluded.message_id, inbox_records.message_id),
      provider_id = COALESCE(excluded.provider_id, inbox_records.provider_id),
      model = COALESCE(excluded.model, inbox_records.model),
      working_directory = COALESCE(excluded.working_directory, inbox_records.working_directory),
      prompt_text = excluded.prompt_text,
      prompt_summary = excluded.prompt_summary,
      context_json = COALESCE(excluded.context_json, inbox_records.context_json),
      updated_at = excluded.updated_at
  `).run(
    params.id,
    "pending",
    params.platform,
    workspace.workspaceId,
    workspace.workspaceName,
    params.channelId,
    workspace.channelName,
    params.rawChannelId ?? null,
    params.threadId,
    params.replyThreadId,
    params.sessionId ?? null,
    params.userId ?? null,
    params.messageId ?? null,
    params.providerId ?? null,
    params.model ?? null,
    params.workingDirectory ?? null,
    params.promptText,
    promptSummary,
    toJsonText(params.context),
    now,
    now
  );

  return params.id;
}

export function completeInboxRecord(params: {
  id: string;
  resultText: string;
  sessionId?: string | null;
  providerId?: string | null;
  model?: string | null;
  workingDirectory?: string | null;
}): void {
  const db = getDatabase();
  const now = Date.now();
  const resultSummary = createSummary(params.resultText);

  db.query(`
    UPDATE inbox_records
    SET
      status = 'completed',
      result_text = ?,
      result_summary = ?,
      error_text = NULL,
      session_id = COALESCE(?, session_id),
      provider_id = COALESCE(?, provider_id),
      model = COALESCE(?, model),
      working_directory = COALESCE(?, working_directory),
      updated_at = ?,
      completed_at = ?
    WHERE id = ?
  `).run(
    params.resultText,
    resultSummary,
    params.sessionId ?? null,
    params.providerId ?? null,
    params.model ?? null,
    params.workingDirectory ?? null,
    now,
    now,
    params.id
  );
}

export function failInboxRecord(params: {
  id: string;
  errorText: string;
  resultText?: string | null;
  sessionId?: string | null;
  providerId?: string | null;
  model?: string | null;
  workingDirectory?: string | null;
}): void {
  const db = getDatabase();
  const now = Date.now();
  const resultText = params.resultText ?? null;
  const resultSummary = resultText ? createSummary(resultText) : null;

  db.query(`
    UPDATE inbox_records
    SET
      status = 'failed',
      result_text = COALESCE(?, result_text),
      result_summary = COALESCE(?, result_summary),
      error_text = ?,
      session_id = COALESCE(?, session_id),
      provider_id = COALESCE(?, provider_id),
      model = COALESCE(?, model),
      working_directory = COALESCE(?, working_directory),
      updated_at = ?
    WHERE id = ?
  `).run(
    resultText,
    resultSummary,
    params.errorText,
    params.sessionId ?? null,
    params.providerId ?? null,
    params.model ?? null,
    params.workingDirectory ?? null,
    now,
    params.id
  );
}

export function getInboxPage(params?: {
  page?: number;
  pageSize?: number;
}): InboxPage {
  const db = getDatabase();
  const pageSize = Math.max(1, Math.min(100, Math.floor(params?.pageSize ?? 20)));
  const page = Math.max(1, Math.floor(params?.page ?? 1));
  const offset = (page - 1) * pageSize;
  const totalRow = db.query("SELECT COUNT(*) AS count FROM inbox_records").get() as { count: number } | null;
  const total = totalRow?.count ?? 0;
  const rows = db.query(`
    SELECT *
    FROM inbox_records
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset) as InboxRow[];

  return {
    items: rows.map(mapSummaryRow),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function getInboxRecordById(id: string): InboxRecordDetail | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM inbox_records WHERE id = ?").get(id) as InboxRow | null;
  if (!row) return null;
  return mapDetailRow(row);
}

export function clearInboxRecordsForTests(): void {
  const db = getDatabase();
  db.exec("DELETE FROM inbox_records;");
}

export function closeInboxDatabaseForTests(): void {
  if (!cachedDatabase) return;
  try {
    cachedDatabase.db.close();
  } catch {
    // Ignore close errors in tests.
  } finally {
    cachedDatabase = null;
  }
}
