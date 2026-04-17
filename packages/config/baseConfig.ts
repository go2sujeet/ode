export const STATUS_MESSAGE_FORMAT_VALUES = ["aggressive", "medium", "minimum"] as const;

export type StatusMessageFormat = typeof STATUS_MESSAGE_FORMAT_VALUES[number];

export const STATUS_MESSAGE_FORMAT_OPTIONS: ReadonlyArray<{ label: string; value: StatusMessageFormat }> = [
  { label: "Aggressive", value: "aggressive" },
  { label: "Medium", value: "medium" },
  { label: "Minimum", value: "minimum" },
];

export const TOOL_DISPLAY_CONFIG: Record<
  StatusMessageFormat,
  { itemLimit: number; detailLimit: number | null }
> = {
  minimum: { itemLimit: 4, detailLimit: 30 },
  medium: { itemLimit: 6, detailLimit: 100 },
  aggressive: { itemLimit: 8, detailLimit: 200 },
};

export const GIT_STRATEGY_VALUES = ["worktree", "default"] as const;

export type GitStrategy = typeof GIT_STRATEGY_VALUES[number];

export const GIT_STRATEGY_OPTIONS: ReadonlyArray<{ label: string; value: GitStrategy }> = [
  { label: "Worktree", value: "worktree" },
  { label: "Default", value: "default" },
];

export const AUTO_UPDATE_VALUES = ["on", "off"] as const;

export type AutoUpdateSetting = typeof AUTO_UPDATE_VALUES[number];

export const AUTO_UPDATE_OPTIONS: ReadonlyArray<{ label: string; value: AutoUpdateSetting }> = [
  { label: "On", value: "on" },
  { label: "Off", value: "off" },
];

export const DEFAULT_GIT_STRATEGY: GitStrategy = "worktree";

export function isStatusMessageFormat(value: unknown): value is StatusMessageFormat {
  return typeof value === "string" && STATUS_MESSAGE_FORMAT_VALUES.some((item) => item === value);
}

export function normalizeStatusMessageFormat(value: unknown): StatusMessageFormat {
  return isStatusMessageFormat(value) ? value : "medium";
}

export function isGitStrategy(value: unknown): value is GitStrategy {
  return typeof value === "string" && GIT_STRATEGY_VALUES.some((item) => item === value);
}

export function normalizeGitStrategy(value: unknown): GitStrategy {
  return value === "default" ? "default" : "worktree";
}

export function isAutoUpdateSetting(value: unknown): value is AutoUpdateSetting {
  return typeof value === "string" && AUTO_UPDATE_VALUES.some((item) => item === value);
}

export function normalizeAutoUpdateSetting(value: unknown): AutoUpdateSetting {
  return value === "off" ? "off" : "on";
}
