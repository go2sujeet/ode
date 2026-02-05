import { log } from "@ode/utils";

export type CorePhase =
  | "idle"
  | "preparing_session"
  | "preparing_worktree"
  | "processing"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "stopped";

export type CoreEvent =
  | "prepare_session"
  | "prepare_worktree"
  | "start_processing"
  | "wait_for_user"
  | "resume_processing"
  | "complete"
  | "fail"
  | "stop";

const EVENT_TO_PHASE: Record<CoreEvent, CorePhase> = {
  prepare_session: "preparing_session",
  prepare_worktree: "preparing_worktree",
  start_processing: "processing",
  wait_for_user: "waiting_for_user",
  resume_processing: "processing",
  complete: "completed",
  fail: "failed",
  stop: "stopped",
};

const ALLOWED_TRANSITIONS: Record<CorePhase, Set<CorePhase>> = {
  idle: new Set(["preparing_session", "preparing_worktree", "processing"]),
  preparing_session: new Set(["preparing_worktree", "processing", "failed", "stopped"]),
  preparing_worktree: new Set(["processing", "failed", "stopped"]),
  processing: new Set(["waiting_for_user", "completed", "failed", "stopped"]),
  waiting_for_user: new Set(["processing", "failed", "stopped"]),
  completed: new Set(["processing", "preparing_session", "preparing_worktree"]),
  failed: new Set(["processing", "preparing_session", "preparing_worktree"]),
  stopped: new Set(["processing", "preparing_session", "preparing_worktree"]),
};

export class CoreStateMachine {
  readonly id: string;
  phase: CorePhase;
  updatedAt: number;

  constructor(id: string) {
    this.id = id;
    this.phase = "idle";
    this.updatedAt = Date.now();
  }

  transition(event: CoreEvent): CorePhase {
    const next = EVENT_TO_PHASE[event];
    const allowed = ALLOWED_TRANSITIONS[this.phase];
    if (!allowed.has(next)) {
      log.debug("Core state transition ignored", { id: this.id, from: this.phase, to: next, event });
      return this.phase;
    }
    this.phase = next;
    this.updatedAt = Date.now();
    return this.phase;
  }
}
