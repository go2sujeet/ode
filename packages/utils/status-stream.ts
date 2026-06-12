// ---------------------------------------------------------------------------
// SessionMessageState → Slack streaming-API chunk diff.
//
// Companion to packages/utils/status.ts (which renders the whole status as
// markdown text for chat.update). This module instead produces incremental
// `task_update` / `plan_update` chunks that Slack's chat.appendStream API
// renders as animated task cards in a plan block.
//
// Usage from the kernel:
//   const differ = createStatusStreamDiffer();
//   // on each progress tick:
//   const chunks = differ.diff(state, request);
//   if (chunks.length > 0) await im.appendStatusStream(...chunks);
//
// Design notes:
//   - We render one complete live-status card: run context, current phase,
//     tasks, and tool calling all update in place inside the same
//     Slack plan card.
//   - We use stable synthetic task_update ids (meta/context, group:tasks,
//     etc.) instead of raw tool ids. Slack updates rows with the same id, so
//     long runs stay compact instead of appending an unbounded tool log.
//   - We only emit a chunk when a row's effective shape (title/status/output)
//     actually changes — Slack drops near-duplicate appends but emitting them
//     anyway wastes the Tier-4 budget (100/min).
//   - The plan title summarizes the full status and intentionally avoids
//     per-tool phases such as "Running tool: Bash"; those live in the phase
//     row so the card header does not flicker.
//   - All free-text fields are pre-truncated to Slack's 256-char chunk limit
//     inside serializeStreamChunk (api.ts) — here we focus on shape & diffing.
// ---------------------------------------------------------------------------

import type { SessionMessageState, SessionTodo, SessionTool } from "./session-inspector";
import type { StatusStreamChunk } from "@/core/types";
import { formatElapsedTime, trimToolPath } from "./status";

type TaskStatus = "pending" | "in_progress" | "complete" | "error";

type RowFingerprint = {
  title: string;
  status: TaskStatus;
  details?: string;
  output?: string;
};

type TaskRow = RowFingerprint & {
  id: string;
};

const MAX_TODO_ROWS = 5;
const MAX_TOOL_ROWS = 6;

function mapToolStatus(status: string): TaskStatus {
  switch (status) {
    case "running":
      return "in_progress";
    case "pending":
      return "pending";
    case "error":
      return "error";
    case "completed":
    default:
      return "complete";
  }
}

function mapTodoStatus(status: string): TaskStatus {
  switch ((status || "").toLowerCase()) {
    case "completed":
    case "complete":
    case "done":
      return "complete";
    case "in_progress":
    case "in progress":
    case "running":
      return "in_progress";
    case "error":
    case "failed":
      return "error";
    case "pending":
    default:
      return "pending";
  }
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

  if (unitIndex === 0) return `${sign}${Math.round(current)}`;

  const rounded = current >= 10
    ? Math.round(current)
    : Math.round(current * 10) / 10;
  return `${sign}${rounded}${units[unitIndex]}`;
}

function truncateField(value: string, maxLength = 220): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function compactFinalTextPreview(text: string | undefined, maxLength = 110): string | undefined {
  const compact = text
    ?.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/[`*_#]/g, "")
    .trim();
  if (!compact) return undefined;
  return truncateField(compact, maxLength);
}

function compactPath(path: string): string {
  const home = process.env.HOME;
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  if (home && trimmed.startsWith(`${home}/`)) {
    return `~/${trimmed.slice(home.length + 1)}`;
  }
  return trimmed;
}

function buildPlanTitle(state: SessionMessageState, startedAt: number): string {
  const title = state.sessionTitle?.trim() || state.agent?.trim() || "Working";
  const elapsed = formatElapsedTime(startedAt);
  return truncateField([title, state.agent?.trim(), state.model?.trim(), elapsed].filter(Boolean).join(" · "), 160);
}

function buildContextRow(runMode: string | undefined, workingPath: string): TaskRow {
  const mode = runMode?.trim() || "build mode";
  return {
    id: "meta:context",
    title: "Run context",
    status: "complete",
    details: mode,
    output: truncateField(compactPath(workingPath), 180),
  };
}

function buildCurrentStatusRow(state: SessionMessageState): TaskRow {
  const phase = state.phaseStatus?.trim() || "Working";
  const detail = state.thinkingText?.trim() || state.currentText?.trim();
  const waitingForUser = /\b(waiting|question|approval|permission|confirm|choose|select|input)\b/i.test(phase);
  const finalizing = /\b(done|complete|completed|finalizing|finalized)\b/i.test(phase);
  return {
    id: "meta:phase",
    title: "Current status",
    status: waitingForUser ? "in_progress" : finalizing ? "complete" : "in_progress",
    details: truncateField(detail ? `${phase}: ${detail}` : phase, 220),
  };
}

function getToolDisplayName(name: string): string {
  switch ((name || "").toLowerCase()) {
    case "read_file":
    case "read_many_files":
      return "read";
    case "write_file":
      return "write";
    case "run_shell_command":
      return "bash";
    case "grep_search":
      return "grep";
    default:
      return name || "tool";
  }
}

/**
 * Build a short, human-readable task title from a SessionTool. Mirrors the
 * one-liners that buildToolLines() shows in the plain-text status, e.g.
 *   bash `git status`
 *   read packages/core/kernel/request-run.ts
 *   grep "TODO" in packages/
 *
 * Stays well under Slack's 256-char chunk cap; the streaming layer truncates
 * again as a safety net.
 */
function buildTaskTitle(tool: SessionTool, workingPath: string): string {
  const display = getToolDisplayName(tool.name);
  const input = (tool.input || {}) as Record<string, unknown>;
  const lowered = (tool.name || "").toLowerCase();

  if (lowered === "bash" || lowered === "run_shell_command") {
    const cmd = String(input.command || input.cmd || "").trim();
    if (cmd) return `bash: ${cmd.slice(0, 180)}`;
  }
  if (lowered === "read" || lowered === "read_file" || lowered === "read_many_files") {
    const file = String(input.filePath || input.file_path || input.absolute_path || "");
    if (file) return `read ${trimToolPath(file, workingPath)}`;
  }
  if (lowered === "edit" || lowered === "write" || lowered === "write_file") {
    const file = String(input.filePath || input.file_path || input.absolute_path || "");
    if (file) return `${display} ${trimToolPath(file, workingPath)}`;
  }
  if (lowered === "grep" || lowered === "rg" || lowered === "ripgrep" || lowered === "grep_search") {
    const pattern = String(input.pattern || "");
    const path = trimToolPath(String(input.path || "."), workingPath);
    if (pattern) return `grep ${pattern} in ${path}`.trim();
  }
  if (lowered === "glob") {
    const pattern = String(input.pattern || "");
    const path = trimToolPath(String(input.path || "."), workingPath);
    if (pattern) return `glob ${pattern} in ${path}`.trim();
  }

  // Fall back to the SDK-provided title or the bare tool name.
  const title = tool.title?.trim();
  return title ? `${display} ${trimToolPath(title, workingPath)}` : display;
}

function fingerprintsEqual(a: RowFingerprint, b: RowFingerprint): boolean {
  return (
    a.title === b.title &&
    a.status === b.status &&
    (a.details ?? "") === (b.details ?? "") &&
    (a.output ?? "") === (b.output ?? "")
  );
}

function selectRecentTools(tools: SessionTool[]): SessionTool[] {
  const visible = tools.filter((tool) => tool.id);
  return visible.slice(Math.max(0, visible.length - MAX_TOOL_ROWS));
}

function aggregateStatuses(statuses: TaskStatus[]): TaskStatus {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("in_progress")) return "in_progress";
  if (statuses.length > 0 && statuses.every((status) => status === "complete")) return "complete";
  return "pending";
}

function formatTodoStatus(status: string): string {
  switch (mapTodoStatus(status)) {
    case "complete":
      return "done";
    case "in_progress":
      return "in progress";
    case "error":
      return "error";
    case "pending":
    default:
      return "pending";
  }
}

function formatToolStatus(status: string): string {
  switch (mapToolStatus(status)) {
    case "complete":
      return "done";
    case "in_progress":
      return "running";
    case "error":
      return "error";
    case "pending":
    default:
      return "pending";
  }
}

function buildTasksRow(todos: SessionTodo[]): TaskRow {
  const visibleTodos = todos.slice(0, MAX_TODO_ROWS);
  const details = visibleTodos.length > 0
    ? visibleTodos.map((todo) => `- ${formatTodoStatus(todo.status)}: ${todo.content || "Task"}`).join("\n")
    : "- pending: waiting for task updates";
  return {
    id: "group:tasks",
    title: "Tasks",
    status: aggregateStatuses(visibleTodos.map((todo) => mapTodoStatus(todo.status))),
    details: truncateField(details, 220),
  };
}

function buildToolsRow(tools: SessionTool[], workingPath: string): TaskRow {
  const visibleTools = selectRecentTools(tools);
  const details = visibleTools.length > 0
    ? visibleTools.map((tool) => `- ${formatToolStatus(tool.status)}: ${buildTaskTitle(tool, workingPath)}`).join("\n")
    : "- pending: no active tool call";
  return {
    id: "group:tools",
    title: "Tool calling",
    status: aggregateStatuses(visibleTools.map((tool) => mapToolStatus(tool.status))),
    details: truncateField(details, 220),
  };
}

function buildTaskRows(input: StatusStreamDiffInput): TaskRow[] {
  const { state, workingPath, runMode } = input;
  return [
    buildContextRow(runMode, workingPath),
    buildCurrentStatusRow(state),
    buildTasksRow(state.todos),
    buildToolsRow(state.tools, workingPath),
  ];
}

export type StatusStreamDiffInput = {
  state: SessionMessageState;
  workingPath: string;
  startedAt: number;
  runMode?: string;
};

export type StatusStreamDiffResult = {
  /** Chunks to send to chat.appendStream. May be empty (no-op). */
  chunks: StatusStreamChunk[];
  /**
   * Call AFTER chat.appendStream confirms success — this advances the
   * differ's internal fingerprint cache so the same chunks aren't sent
   * again. If the append fails, do NOT call commit: next diff() will
   * re-emit the unconfirmed chunks (Slack will dedupe idempotent
   * task_update payloads, and rate/network failures recover instead of
   * leaving task cards permanently stale).
   */
  commit(): void;
};

export type StatusStreamDiffer = {
  /**
   * Compute the chunks needed to bring the Slack-side stream in sync with
   * the latest SessionMessageState, plus a `commit()` callback the caller
   * runs after the network append succeeds. When the chunks list is empty
   * the caller should skip both the appendStream round-trip and commit().
   */
  diff(input: StatusStreamDiffInput): StatusStreamDiffResult;
  /**
   * Compose a short final summary line for the terminal plan_update chunk
   * we emit just before chat.stopStream. Kept separate from `diff()`
   * because stopping is a one-shot terminal transition.
   */
  finalize(input: StatusStreamDiffInput, finalText?: string): string;
};

export function createStatusStreamDiffer(): StatusStreamDiffer {
  const lastFingerprints = new Map<string, RowFingerprint>();
  let lastPlanTitle: string | undefined;

  return {
    diff({ state, workingPath, startedAt, runMode }) {
      const chunks: StatusStreamChunk[] = [];
      // Pending updates accumulated this tick. Only applied to
      // lastFingerprints / lastPlanTitle when commit() runs, so a network
      // failure leaves the old state in place and the next tick re-emits
      // the same delta.
      const pendingFingerprints: Array<[string, RowFingerprint]> = [];
      let pendingPlanTitle: string | undefined;
      let planTitleChanged = false;

      const planTitle = buildPlanTitle(state, startedAt);
      if (planTitle !== lastPlanTitle) {
        chunks.push({ type: "plan_update", title: planTitle });
        pendingPlanTitle = planTitle;
        planTitleChanged = true;
      }

      for (const row of buildTaskRows({ state, workingPath, startedAt, runMode })) {
        const { id, ...fp } = row;
        const prev = lastFingerprints.get(id);
        if (prev && fingerprintsEqual(prev, fp)) continue;
        pendingFingerprints.push([id, fp]);
        chunks.push({
          type: "task_update",
          id,
          title: fp.title,
          status: fp.status,
          ...(fp.details ? { details: fp.details } : {}),
          ...(fp.output ? { output: fp.output } : {}),
        });
      }

      return {
        chunks,
        commit() {
          if (planTitleChanged) lastPlanTitle = pendingPlanTitle;
          for (const [id, fp] of pendingFingerprints) {
            lastFingerprints.set(id, fp);
          }
        },
      };
    },

    finalize({ state, startedAt }, finalText) {
      const elapsed = formatElapsedTime(startedAt);
      const usage = state.tokenUsage;
      const tokenSuffix = usage && usage.total > 0
        ? ` · ${formatCompactCount(usage.total)} tokens`
        : "";
      const costSuffix = usage && typeof usage.cost === "number" && usage.cost > 0
        ? ` · $${usage.cost.toFixed(3)}`
        : "";
      const titlePart = state.sessionTitle ? `${state.sessionTitle} · ` : "";
      const resultPart = compactFinalTextPreview(finalText);
      const statusPart = `Done in ${elapsed}${tokenSuffix}${costSuffix}`;
      return truncateField(
        resultPart
          ? `${titlePart}Result: ${resultPart} · ${statusPart}`
          : `${titlePart}${statusPart}`,
        240
      );
    },
  };
}
