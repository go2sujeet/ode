import { createCoreRuntime } from "@/core/runtime";
import type { IMAdapter } from "@/core/types";
import { createAgentAdapter } from "@/agents/adapter";
import type { OpenCodeMessageContext } from "@/agents";
import {
  getChannelSystemMessage,
  getGitHubInfoForUser,
  getGitHubWorkspaces,
  getGitHubTargetRepos,
} from "@/config";
import { log } from "@/utils";
import { createRuntimeController } from "@/ims/shared/runtime-controller";
import { createProcessorId } from "@/ims/shared/processor-id";
import { createProcessorManager } from "@/ims/shared/processor-manager";
import type { RawInboundEvent } from "@/core/model/raw-inbound-event";
import {
  createComment,
  updateComment,
  deleteComment,
  getIssueComments,
  getIssue,
  parseRepoFullName,
  type GitHubRepo,
} from "./utils";

const githubProcessorManager = createProcessorManager({
  createRuntime: (processorId) => createCoreRuntime({
    platform: "github",
    im: createGitHubAdapter(processorId),
    agent: createAgentAdapter(),
  }),
});

function getGitHubProcessorRuntime(processorId: string): ReturnType<typeof createCoreRuntime> {
  return githubProcessorManager.getRuntime(processorId);
}

const githubWorkspaceProcessors = new Map<string, string>();

function getRepoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function getWorkspaceForRepo(owner: string, repo: string): { workspaceId: string; token: string; botName: string } | null {
  const repoKey = getRepoKey(owner, repo);
  for (const ws of getGitHubWorkspaces()) {
    const configuredRepos = getGitHubTargetRepos();
    if (configuredRepos && configuredRepos.includes(repoKey)) {
      return { workspaceId: ws.workspaceId, token: ws.token, botName: ws.botName || "ode" };
    }
  }
  return null;
}

async function sendGitHubMessage(
  channelId: string,
  threadId: string,
  text: string,
  token: string
): Promise<string | undefined> {
  try {
    const { owner, repo } = parseRepoFullName(channelId);
    const issueNumber = parseInt(threadId, 10);
    if (!Number.isFinite(issueNumber)) {
      log.warn("Invalid GitHub issue number", { channelId, threadId });
      return undefined;
    }
    const commentId = await createComment({ token, owner, repo, issueNumber, body: text });
    return String(commentId);
  } catch (error) {
    log.warn("Failed to send GitHub comment", { channelId, threadId, error: String(error) });
    throw error;
  }
}

async function updateGitHubMessage(
  channelId: string,
  messageId: string,
  text: string,
  token: string
): Promise<void> {
  try {
    const { owner, repo } = parseRepoFullName(channelId);
    const commentId = parseInt(messageId, 10);
    if (!Number.isFinite(commentId)) return;
    await updateComment({ token, owner, repo, commentId, body: text });
  } catch (error) {
    log.warn("Failed to update GitHub comment", { channelId, messageId, error: String(error) });
    throw error;
  }
}

async function deleteGitHubMessage(
  channelId: string,
  messageId: string,
  token: string
): Promise<void> {
  try {
    const { owner, repo } = parseRepoFullName(channelId);
    const commentId = parseInt(messageId, 10);
    if (!Number.isFinite(commentId)) return;
    await deleteComment({ token, owner, repo, commentId });
  } catch (error) {
    log.warn("Failed to delete GitHub comment", { channelId, messageId, error: String(error) });
    throw error;
  }
}

async function fetchGitHubThreadHistory(
  channelId: string,
  threadId: string,
  token: string
): Promise<string | null> {
  try {
    const { owner, repo } = parseRepoFullName(channelId);
    const issueNumber = parseInt(threadId, 10);
    if (!Number.isFinite(issueNumber)) return null;
    const comments = await getIssueComments({ token, owner, repo, issueNumber });
    const lines = comments
      .filter((c) => c.body)
      .map((c) => `${c.user.login}: ${c.body}`);
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

function resolveGitHubToken(channelId: string): string | null {
  try {
    const { owner, repo } = parseRepoFullName(channelId);
    const ws = getWorkspaceForRepo(owner, repo);
    return ws?.token ?? null;
  } catch {
    return null;
  }
}

function createGitHubAdapter(processorId?: string): IMAdapter {
  return {
    sendMessage: async (channelId: string, threadId: string, text: string) => {
      const token = resolveGitHubToken(channelId);
      if (!token) throw new Error("No GitHub token configured for this repo");
      return sendGitHubMessage(channelId, threadId, text, token);
    },
    updateMessage: async (channelId: string, messageId: string, text: string) => {
      const token = resolveGitHubToken(channelId);
      if (!token) return;
      await updateGitHubMessage(channelId, messageId, text, token);
    },
    deleteMessage: async (channelId: string, messageId: string) => {
      const token = resolveGitHubToken(channelId);
      if (!token) return;
      await deleteGitHubMessage(channelId, messageId, token);
    },
    fetchThreadHistory: async (channelId: string, threadId: string, _messageId: string) => {
      const token = resolveGitHubToken(channelId);
      if (!token) return null;
      return fetchGitHubThreadHistory(channelId, threadId, token);
    },
    buildAgentContext: async ({ channelId, threadId, userId, threadHistory }) => {
      let issueTitle = "";
      try {
        const { owner, repo } = parseRepoFullName(channelId);
        const issueNumber = parseInt(threadId, 10);
        if (Number.isFinite(issueNumber)) {
          const token = resolveGitHubToken(channelId);
          if (token) {
            const issue = await getIssue({ token, owner, repo, issueNumber });
            issueTitle = issue.title;
          }
        }
      } catch {
        // ignore
      }
      return {
        threadHistory: threadHistory ?? undefined,
        slack: {
          platform: "github",
          channelId,
          threadId,
          userId,
          threadHistory: threadHistory ?? undefined,
          hasGitHubToken: Boolean(resolveGitHubToken(channelId)),
          channelSystemMessage: getChannelSystemMessage(channelId) ?? undefined,
          issueTitle: issueTitle || undefined,
          repoFullName: channelId,
        },
      };
    },
  };
}

const githubAdapter: IMAdapter = createGitHubAdapter();

const githubRecoveryRuntime = createCoreRuntime({
  platform: "github",
  im: githubAdapter,
  agent: createAgentAdapter(),
});

export async function handleGitHubWebhookEvent(event: RawInboundEvent): Promise<void> {
  const runtime = getGitHubProcessorRuntime(event.botId);
  await runtime.handleInboundEvent(event);
}

async function startGitHubRuntimeInternal(reason: string): Promise<boolean> {
  const workspaces = getGitHubWorkspaces();
  if (workspaces.length === 0) {
    log.debug("GitHub runtime skipped (no GitHub workspaces configured)", { reason });
    return false;
  }
  log.debug("GitHub runtime ready", { reason, workspaceCount: workspaces.length });
  return true;
}

export async function startGitHubRuntime(reason: string): Promise<boolean> {
  return githubRuntimeController.start(reason);
}

export async function stopGitHubRuntime(reason: string): Promise<void> {
  await githubRuntimeController.stop(reason);
}

const githubRuntimeController = createRuntimeController({
  isRunning: () => getGitHubWorkspaces().length > 0,
  startInternal: startGitHubRuntimeInternal,
  stopInternal: async (reason: string) => {
    githubProcessorManager.clear();
    log.debug("GitHub runtime stopped", { reason });
  },
});

export async function recoverPendingRequests(options?: { startedBeforeMs?: number }): Promise<void> {
  await githubRecoveryRuntime.recoverPendingRequests(options);
}

export { getWorkspaceForRepo, resolveGitHubToken };
