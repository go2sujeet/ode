import { spawnSync } from "child_process";
import { getGitHubInfoForUser } from "@/config";
import { ensureSessionWorktree, log } from "@/utils";

export type SessionEnvironment = Record<string, string>;

type GitIdentity = {
  gitName?: string;
  gitEmail?: string;
};

export type SessionPreparation = {
  env: SessionEnvironment;
  gitIdentity: GitIdentity;
};

export type PreparedWorkspace = {
  cwd: string;
  worktree: Awaited<ReturnType<typeof ensureSessionWorktree>>;
};

export function buildSessionEnvironment(params: {
  threadOwnerUserId: string;
}): SessionPreparation {
  const { threadOwnerUserId } = params;
  const githubInfo = getGitHubInfoForUser(threadOwnerUserId);
  const env: SessionEnvironment = {};

  if (githubInfo?.token) {
    env.GH_TOKEN = githubInfo.token;
    env.GITHUB_TOKEN = githubInfo.token;
  }
  if (githubInfo?.gitName) {
    env.GIT_AUTHOR_NAME = githubInfo.gitName;
    env.GIT_COMMITTER_NAME = githubInfo.gitName;
  }
  if (githubInfo?.gitEmail) {
    env.GIT_AUTHOR_EMAIL = githubInfo.gitEmail;
    env.GIT_COMMITTER_EMAIL = githubInfo.gitEmail;
  }
  return {
    env,
    gitIdentity: {
      gitName: githubInfo?.gitName,
      gitEmail: githubInfo?.gitEmail,
    },
  };
}

function setWorktreeGitIdentity(params: {
  cwd: string;
  channelId: string;
  threadId: string;
  gitIdentity: GitIdentity;
}): void {
  const { cwd, channelId, threadId, gitIdentity } = params;
  if (!gitIdentity.gitName && !gitIdentity.gitEmail) return;

  const updates: Array<[string, string | undefined]> = [
    ["user.name", gitIdentity.gitName],
    ["user.email", gitIdentity.gitEmail],
  ];
  log.debug("Setting git identity in worktree config", {
    channelId,
    threadId,
    hasName: Boolean(gitIdentity.gitName),
    hasEmail: Boolean(gitIdentity.gitEmail),
  });
  for (const [key, value] of updates) {
    if (!value) continue;
    const result = spawnSync("git", ["config", "--worktree", key, value], {
      cwd,
      env: { ...process.env },
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      log.warn("Failed to set git config for worktree", {
        channelId,
        threadId,
        key,
        error: String(result.stderr || result.stdout || "unknown error").trim(),
      });
    }
  }
}

export async function prepareSessionWorkspace(params: {
  channelId: string;
  threadId: string;
  cwd: string;
  worktreeId: string;
  baseBranch: string;
  sessionEnv: SessionEnvironment;
  gitIdentity: GitIdentity;
}): Promise<PreparedWorkspace> {
  const { channelId, threadId, cwd, worktreeId, baseBranch, sessionEnv, gitIdentity } = params;
  const worktree = await ensureSessionWorktree({ cwd, worktreeId, baseBranch, env: sessionEnv });
  let resolvedCwd = cwd;

  if (!worktree.skipped && worktree.worktreePath !== cwd) {
    resolvedCwd = worktree.worktreePath;
  }

  if (!worktree.skipped) {
    setWorktreeGitIdentity({
      cwd: resolvedCwd,
      channelId,
      threadId,
      gitIdentity,
    });
  }

  return { cwd: resolvedCwd, worktree };
}
