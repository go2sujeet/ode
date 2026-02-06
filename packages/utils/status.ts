import {
  TOOL_DISPLAY_CONFIG,
  type MessageFrequency,
} from "@/config/web";
import type { SessionMessageState } from "./session-inspector";

export type StatusRequest = {
  channelId: string;
  threadId: string;
  statusMessageTs: string;
  startedAt: number;
  currentText: string;
  statusFrozen?: boolean;
};

export type AgentStatusProvider = "opencode" | "claudecode" | "codex";

type StatusTodo = {
  content: string;
  status: string;
};

const PLAN_TODO_LIMIT = 15;

export function formatElapsedTime(startedAt: number): string {
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function getToolIcon(status: string): string {
  switch (status) {
    case "running":
    case "pending":
      return "~";
    case "error":
      return "!";
    case "completed":
    default:
      return "-";
  }
}

export function getTodoIcon(status: string): string {
  switch (status) {
    case "completed":
      return "✅";
    case "in_progress":
      return "▶️";
    default:
      return "⬜";
  }
}

export function getStatusMessageKey(request: StatusRequest): string {
  return `${request.channelId}:${request.threadId}:${request.statusMessageTs}`;
}

function getRepoRoot(workingPath: string): string {
  const markers = ["/.worktree/", "/.worktrees/"];
  for (const marker of markers) {
    const matchIndex = workingPath.indexOf(marker);
    if (matchIndex >= 0) {
      return workingPath.slice(0, matchIndex);
    }
  }
  return workingPath;
}

export function trimToolPath(label: string, workingPath: string): string {
  let trimmed = label.trim();
  if (!trimmed) return trimmed;

  const repoRoot = getRepoRoot(workingPath);
  if (repoRoot && trimmed.startsWith(`${repoRoot}/`)) {
    trimmed = trimmed.slice(repoRoot.length + 1);
  }

  if (trimmed.startsWith(`${workingPath}/`)) {
    trimmed = trimmed.slice(workingPath.length + 1);
  }

  trimmed = trimmed.replace(/(^|\/)\.worktrees\/[^/]+\//, "");
  trimmed = trimmed.replace(/(^|\/)\.worktree\/[^/]+\//, "");
  trimmed = trimmed.replace(/^\//, "");
  return trimmed;
}

function formatTodoLines(todos: StatusTodo[], limit = PLAN_TODO_LIMIT): string[] {
  const lines: string[] = [];
  for (const todo of todos.slice(0, limit)) {
    const statusLabel = todo.status === "in_progress"
      ? "in progress"
      : todo.status;
    lines.push(`\`${statusLabel}\` ${todo.content}`);
  }
  if (todos.length > limit) {
    lines.push(`_(+${todos.length - limit} more)_`);
  }
  return lines;
}

function buildToolDetails(tool: SessionMessageState["tools"][number], workingPath: string): string {
  const name = tool.name?.toLowerCase?.() ?? "";
  const input = tool.input || {};
  const title = tool.title?.trim() ?? "";

  if (name === "grep" || name === "ripgrep" || name === "rg") {
    const pattern = input.pattern || "";
    const path = trimToolPath(String(input.path || "."), workingPath);
    return `${pattern} in ${path}`.trim();
  }

  if (name === "glob") {
    const pattern = input.pattern || "";
    const path = trimToolPath(String(input.path || "."), workingPath);
    return `${pattern} in ${path}`.trim();
  }

  if (name === "read") {
    const filePath = input.filePath || input.file_path;
    const offset = typeof input.offset === "number" ? input.offset : undefined;
    const limit = typeof input.limit === "number" ? input.limit : undefined;
    let details = filePath ? trimToolPath(String(filePath), workingPath) : "";
    if (details && (offset !== undefined || limit !== undefined)) {
      const offsetLabel = offset !== undefined ? `offset ${offset}` : "";
      const limitLabel = limit !== undefined ? `limit ${limit}` : "";
      const rangeLabel = [offsetLabel, limitLabel].filter(Boolean).join(", ");
      details = `${details} (${rangeLabel})`;
    }
    return details;
  }

  if (name === "edit" || name === "write") {
    const filePath = input.filePath || input.file_path;
    if (filePath) {
      return trimToolPath(String(filePath), workingPath);
    }
  }

  if (name === "bash") {
    return String(input.command || "");
  }

  return title ? trimToolPath(title, workingPath) : "";
}

function truncateToolDetail(detail: string, limit: number | null): string {
  if (limit === null || detail.length <= limit) return detail;
  return `${detail.slice(0, limit)}...`;
}

export function buildToolLines(
  state: SessionMessageState,
  workingPath: string,
  frequency: MessageFrequency
): string[] {
  const tools = state.tools || [];
  if (tools.length === 0) return [];

  const { itemLimit, detailLimit } = TOOL_DISPLAY_CONFIG[frequency];
  const items = tools.length > itemLimit ? tools.slice(-itemLimit) : tools;
  const header = tools.length > itemLimit
    ? `*Tool execution (Last ${itemLimit} items in ${tools.length})*`
    : "*Tool execution*";

  const lines = [header];
  const codeMark = "`";
  for (const tool of items) {
    const details = buildToolDetails(tool, workingPath);
    const truncated = details ? truncateToolDetail(details, detailLimit) : "";
    const suffix = truncated ? ` ${truncated}` : "";
    lines.push(`${getToolIcon(tool.status)} ${codeMark}${tool.name}${codeMark}${suffix}`);
  }

  return lines;
}

export function buildLiveStatusMessage(
  request: StatusRequest,
  workingPath: string,
  state?: SessionMessageState,
  frequency: MessageFrequency = "medium"
): string {
  if (!state) {
    if (request.statusFrozen && request.currentText) {
      return request.currentText;
    }
    return `_Working_ (${formatElapsedTime(request.startedAt)})`;
  }

  if (request.statusFrozen && request.currentText) {
    return request.currentText;
  }

  const lines: string[] = [];

  if (state.sessionTitle) {
    lines.push(`*${state.sessionTitle}* (${formatElapsedTime(state.startedAt)})`);
  } else {
    lines.push(`_${formatElapsedTime(state.startedAt)}_`);
  }

  if (state.phaseStatus) {
    lines.push(`_${state.phaseStatus}_`);
  }

  if (state.todos.length > 0) {
    const todos = state.todos.map((todo) => ({
      content: todo.content,
      status: todo.status,
    }));
    lines.push("", "*Tasks*", ...formatTodoLines(todos));
  }

  const toolLines = buildToolLines(state, workingPath, frequency);
  if (toolLines.length > 0) {
    lines.push("");
    lines.push(...toolLines);
  }

  return lines.join("\n");
}

function buildClaudeToolDetail(tool: SessionMessageState["tools"][number], workingPath: string): string {
  const input = tool.input || {};
  const toolName = tool.name?.toLowerCase?.() ?? "";
  if (toolName === "task") {
    const description = input.description;
    if (typeof description === "string" && description.trim()) {
      return description.trim();
    }
  }
  const filePath = input.filePath || input.file_path;
  const path = input.path;
  const pattern = input.pattern;
  const command = input.command;

  if (typeof filePath === "string" && filePath.trim()) {
    return trimToolPath(filePath, workingPath);
  }
  if (typeof pattern === "string" && pattern.trim()) {
    if (typeof path === "string" && path.trim()) {
      return `${pattern} in ${trimToolPath(path, workingPath)}`;
    }
    return pattern;
  }
  if (typeof path === "string" && path.trim()) {
    return trimToolPath(path, workingPath);
  }
  if (typeof command === "string" && command.trim()) {
    return command;
  }
  if (Array.isArray(input.args) && input.args.length > 0) {
    return input.args.map((value) => String(value)).join(" ");
  }
  if (typeof tool.title === "string" && tool.title.trim()) {
    return trimToolPath(tool.title, workingPath);
  }
  return "";
}

function truncateStatusDetail(value: string, limit = 200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

export function buildClaudeStatusMessage(
  request: StatusRequest,
  workingPath: string,
  state?: SessionMessageState,
  frequency: MessageFrequency = "medium"
): string {
  if (!state) {
    if (request.statusFrozen && request.currentText) return request.currentText;
    return `_Thinking_ (${formatElapsedTime(request.startedAt)})`;
  }

  if (request.statusFrozen && request.currentText) {
    return request.currentText;
  }

  const lines: string[] = [];
  const title = state.sessionTitle || "ClaudeCode";
  lines.push(`*${title}* (${formatElapsedTime(state.startedAt)})`);

  const phase = state.phaseStatus?.trim() || "Thinking";
  lines.push(`_${phase}_`);
  if (state.thinkingText && /thinking/i.test(phase)) {
    lines.push(`_${truncateStatusDetail(state.thinkingText)}_`);
  }

  const tools = state.tools || [];
  if (tools.length > 0) {
    const { itemLimit, detailLimit } = TOOL_DISPLAY_CONFIG[frequency];
    const items = tools.length > itemLimit ? tools.slice(-itemLimit) : tools;
    const header = tools.length > itemLimit
      ? `*Latest actions (Last ${itemLimit} in ${tools.length})*`
      : "*Latest actions*";
    lines.push("", header);
    for (const tool of items) {
      const detail = buildClaudeToolDetail(tool, workingPath);
      const truncated = detail ? truncateToolDetail(detail, detailLimit) : "";
      lines.push(`${getToolIcon(tool.status)} \`${tool.name}\`${truncated ? ` ${truncated}` : ""}`);
    }
  }

  if (state.currentText?.trim()) {
    lines.push("", "*Current response*", state.currentText);
  }

  return lines.join("\n");
}

export function buildStatusMessageByProvider(
  provider: AgentStatusProvider,
  request: StatusRequest,
  workingPath: string,
  state?: SessionMessageState,
  frequency: MessageFrequency = "medium"
): string {
  if (provider === "claudecode") {
    return buildClaudeStatusMessage(request, workingPath, state, frequency);
  }
  return buildLiveStatusMessage(request, workingPath, state, frequency);
}
