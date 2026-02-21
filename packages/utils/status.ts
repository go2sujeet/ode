import {
  TOOL_DISPLAY_CONFIG,
  type StatusMessageFormat,
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

export type AgentStatusProvider = "opencode" | "claudecode" | "codex" | "kimi" | "kiro" | "kilo" | "qwen" | "goose" | "gemini";
const DEFAULT_FALLBACK_TITLE = "Opencode is running...";

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

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const sign = value < 0 ? "-" : "";
  let current = Math.abs(value);
  let unitIndex = 0;
  const units = ["", "k", "m", "b", "t"];

  while (current >= 1000 && unitIndex < units.length - 1) {
    current /= 1000;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${sign}${Math.round(current)}`;
  }

  const rounded = current >= 10
    ? Math.round(current)
    : Math.round(current * 10) / 10;
  const numeric = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${sign}${numeric}${units[unitIndex]}`;
}

function formatCost(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1) return String(Math.round(value * 100) / 100);
  if (value >= 0.01) return value.toFixed(2);
  return value.toFixed(4);
}

function buildHeaderDetails(state: SessionMessageState): string {
  const details: string[] = [];
  if (state.model) {
    details.push(`model: ${state.model}`);
  }

  const totalTokens = state.tokenUsage?.total;
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens > 0) {
    details.push(`${formatCompactCount(totalTokens)} tokens`);
  }

  if (state.agent) {
    details.push(`${state.agent} agent`);
  }

  const cost = state.tokenUsage?.cost;
  if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) {
    details.push(`cost ${formatCost(cost)}`);
  }

  details.push(formatElapsedTime(state.startedAt));
  return details.join(", ");
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

function normalizeToolName(name: string): string {
  switch (name) {
    case "read_file":
    case "read_many_files":
      return "read";
    case "write_file":
      return "write";
    case "run_shell_command":
      return "bash";
    case "grep_search":
      return "grep";
    case "list_directory":
      return "list_directory";
    default:
      return name;
  }
}

function getToolDisplayName(name: string): string {
  switch (name.toLowerCase()) {
    case "read_file":
      return "read";
    case "read_many_files":
      return "read";
    case "write_file":
      return "write";
    case "run_shell_command":
      return "bash";
    case "grep_search":
      return "grep";
    default:
      return name;
  }
}

function buildToolDetails(tool: SessionMessageState["tools"][number], workingPath: string): string {
  const name = normalizeToolName(tool.name?.toLowerCase?.() ?? "");
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
    const filePath = input.filePath || input.file_path || input.absolute_path;
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
    const filePath = input.filePath || input.file_path || input.absolute_path;
    if (filePath) {
      return trimToolPath(String(filePath), workingPath);
    }
  }

  if (name === "list_directory") {
    const path = input.path || input.directory;
    if (path) {
      return trimToolPath(String(path), workingPath);
    }
  }

  if (name === "bash") {
    return String(input.command || input.cmd || "");
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
  statusMessageFormat: StatusMessageFormat
): string[] {
  const tools = state.tools || [];
  if (tools.length === 0) return [];

  const { itemLimit, detailLimit } = TOOL_DISPLAY_CONFIG[statusMessageFormat];
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
    lines.push(`${getToolIcon(tool.status)} ${codeMark}${getToolDisplayName(tool.name)}${codeMark}${suffix}`);
  }

  return lines;
}

export function buildLiveStatusMessage(
  request: StatusRequest,
  workingPath: string,
  state?: SessionMessageState,
  statusMessageFormat: StatusMessageFormat = "medium"
): string {
  if (!state) {
    if (request.statusFrozen && request.currentText) {
      return request.currentText;
    }
    return `${DEFAULT_FALLBACK_TITLE} (${formatElapsedTime(request.startedAt)})`;
  }

  if (request.statusFrozen && request.currentText) {
    return request.currentText;
  }

  const lines: string[] = [];
  const headerDetails = buildHeaderDetails(state);

  if (state.sessionTitle) {
    lines.push(`*${state.sessionTitle}* (${headerDetails})`);
  } else {
    lines.push(`*${DEFAULT_FALLBACK_TITLE}* (${headerDetails})`);
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

  const toolLines = buildToolLines(state, workingPath, statusMessageFormat);
  if (toolLines.length > 0) {
    lines.push("");
    lines.push(...toolLines);
  }

  return lines.join("\n");
}

export function buildStatusMessageByProvider(
  _provider: AgentStatusProvider,
  request: StatusRequest,
  workingPath: string,
  state?: SessionMessageState,
  statusMessageFormat: StatusMessageFormat = "medium"
): string {
  return buildLiveStatusMessage(request, workingPath, state, statusMessageFormat);
}
