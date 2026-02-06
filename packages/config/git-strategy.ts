import { loadOdeConfig } from "./local/ode";
import { DEFAULT_GIT_STRATEGY, type GitStrategy } from "./baseConfig";

export { DEFAULT_GIT_STRATEGY, type GitStrategy };

export function resolveGitStrategy(): GitStrategy {
  try {
    const strategy = loadOdeConfig().user.gitStrategy;
    if (strategy === "default" || strategy === "worktree") {
      return strategy;
    }
  } catch {
    // ignore, fall back to default
  }
  return DEFAULT_GIT_STRATEGY;
}
