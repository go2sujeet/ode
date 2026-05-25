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
//   - We use SessionTool.id as the task_update.id; ids must be stable across
//     ticks for Slack to update the same card instead of appending a new one.
//   - We only emit a chunk when a tool's effective shape (title/status/output)
//     actually changes — Slack drops near-duplicate appends but emitting them
//     anyway wastes the Tier-4 budget (100/min).
//   - The plan title is driven by phaseStatus, with sessionTitle as fallback.
//   - All free-text fields are pre-truncated to Slack's 256-char chunk limit
//     inside serializeStreamChunk (api.ts) — here we focus on shape & diffing.
// ---------------------------------------------------------------------------

import type { SessionMessageState, SessionTool } from "./session-inspector";
import type { StatusStreamChunk } from "@/core/types";
import { formatElapsedTime, trimToolPath } from "./status";

type TaskStatus = "pending" | "in_progress" | "complete" | "error";

type ToolFingerprint = {
  title: string;
  status: TaskStatus;
  details?: string;
  output?: string;
};

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
    if (cmd) return `bash \`${cmd.slice(0, 180)}\``;
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

function fingerprintTool(tool: SessionTool, workingPath: string): ToolFingerprint {
  const status = mapToolStatus(tool.status);
  const title = buildTaskTitle(tool, workingPath);
  const output = status === "complete" || status === "error"
    ? (tool.output || tool.error || "").trim() || undefined
    : undefined;
  const details = status === "in_progress" || status === "pending"
    ? (tool.title?.trim() || undefined)
    : undefined;
  return { title, status, details, output };
}

function fingerprintsEqual(a: ToolFingerprint, b: ToolFingerprint): boolean {
  return (
    a.title === b.title &&
    a.status === b.status &&
    (a.details ?? "") === (b.details ?? "") &&
    (a.output ?? "") === (b.output ?? "")
  );
}

export type StatusStreamDiffInput = {
  state: SessionMessageState;
  workingPath: string;
  startedAt: number;
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
  finalize(input: StatusStreamDiffInput): string;
};

export function createStatusStreamDiffer(): StatusStreamDiffer {
  const lastFingerprints = new Map<string, ToolFingerprint>();
  let lastPlanTitle: string | undefined;

  return {
    diff({ state, workingPath, startedAt }) {
      const chunks: StatusStreamChunk[] = [];
      // Pending updates accumulated this tick. Only applied to
      // lastFingerprints / lastPlanTitle when commit() runs, so a network
      // failure leaves the old state in place and the next tick re-emits
      // the same delta.
      const pendingFingerprints: Array<[string, ToolFingerprint]> = [];
      let pendingPlanTitle: string | undefined;
      let planTitleChanged = false;

      // Plan title: prefer the live phase (e.g. "Running tool: bash"), fall
      // back to the session title, then a generic "Working".
      const planTitle = (state.phaseStatus?.trim()
        || state.sessionTitle?.trim()
        || `Working (${formatElapsedTime(startedAt)})`);
      if (planTitle !== lastPlanTitle) {
        chunks.push({ type: "plan_update", title: planTitle });
        pendingPlanTitle = planTitle;
        planTitleChanged = true;
      }

      // Tools: emit a task_update for each tool whose fingerprint changed.
      // Tools array is append-ordered by the inspector, so this naturally
      // surfaces new tools in the order they fired.
      for (const tool of state.tools) {
        if (!tool.id) continue;
        const fp = fingerprintTool(tool, workingPath);
        const prev = lastFingerprints.get(tool.id);
        if (prev && fingerprintsEqual(prev, fp)) continue;
        pendingFingerprints.push([tool.id, fp]);
        chunks.push({
          type: "task_update",
          id: tool.id,
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

    finalize({ state, startedAt }) {
      const elapsed = formatElapsedTime(startedAt);
      const usage = state.tokenUsage;
      const tokenSuffix = usage && usage.total > 0
        ? ` · ${Math.round(usage.total / 1000)}K tokens`
        : "";
      const costSuffix = usage && typeof usage.cost === "number" && usage.cost > 0
        ? ` · $${usage.cost.toFixed(3)}`
        : "";
      const titlePart = state.sessionTitle ? `*${state.sessionTitle}* — ` : "";
      return `${titlePart}done in ${elapsed}${tokenSuffix}${costSuffix}`;
    },
  };
}
