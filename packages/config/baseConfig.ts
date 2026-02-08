export type StatusMessageFormat = "minimum" | "medium" | "aggressive";

export const TOOL_DISPLAY_CONFIG: Record<
  StatusMessageFormat,
  { itemLimit: number; detailLimit: number | null }
> = {
  minimum: { itemLimit: 4, detailLimit: 30 },
  medium: { itemLimit: 6, detailLimit: 100 },
  aggressive: { itemLimit: 8, detailLimit: null },
};

export type GitStrategy = "default" | "worktree";

export const DEFAULT_GIT_STRATEGY: GitStrategy = "worktree";
