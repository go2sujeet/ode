import { createHmac, timingSafeEqual } from "crypto";
import { getGitHubWorkspaces, getGitHubTargetRepos } from "@/config";
import { isThreadActive, markThreadActive, loadSession } from "@/config/local/sessions";
import { isSyntheticOwner } from "@/ims/shared/synthetic-owner";
import { log } from "@/utils";
import type { RawInboundEvent } from "@/core/model/raw-inbound-event";
import { createProcessorId } from "@/ims/shared/processor-id";
import { getWorkspaceForRepo } from "./client";

export type GitHubWebhookEvent =
  | "issue_comment"
  | "issues"
  | "pull_request"
  | "pull_request_review"
  | "pull_request_review_comment";

function parseEventType(headers: Record<string, string | undefined>): GitHubWebhookEvent | null {
  const event = headers["x-github-event"];
  if (
    event === "issue_comment"
    || event === "issues"
    || event === "pull_request"
    || event === "pull_request_review"
    || event === "pull_request_review_comment"
  ) {
    return event;
  }
  return null;
}

function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function cleanBotMention(text: string, botName: string): string {
  const mentionPattern = new RegExp(`@${botName}\\b`, "gi");
  return text.replace(mentionPattern, "").replace(/\s+/g, " ").trim();
}

function isBotMentioned(text: string, botName: string): boolean {
  const mentionPattern = new RegExp(`@${botName}\\b`, "i");
  return mentionPattern.test(text);
}

type ParsedWebhookPayload = {
  eventType: GitHubWebhookEvent;
  action: string;
  owner: string;
  repo: string;
  issueNumber: number;
  isPr: boolean;
  commentId?: number;
  commentBody?: string;
  commentUser?: string;
  issueTitle?: string;
  issueBody?: string;
  senderLogin: string;
  senderId: number;
};

function parsePayload(eventType: GitHubWebhookEvent, payload: Record<string, unknown>): ParsedWebhookPayload | null {
  const repository = payload.repository as Record<string, unknown> | undefined;
  if (!repository) return null;
  const fullName = (repository.full_name as string) || "";
  const parts = fullName.split("/");
  if (parts.length !== 2) return null;

  const owner = parts[0]!;
  const repo = parts[1]!;
  const sender = (payload.sender as Record<string, unknown>) || {};
  const senderLogin = (sender.login as string) || "unknown";
  const senderId = (sender.id as number) || 0;

  if (eventType === "issue_comment") {
    const issue = payload.issue as Record<string, unknown> | undefined;
    const comment = payload.comment as Record<string, unknown> | undefined;
    if (!issue || !comment) return null;
    const issueNumber = issue.number as number;
    const isPr = !!(issue.pull_request as Record<string, unknown> | undefined);
    return {
      eventType,
      action: (payload.action as string) || "",
      owner,
      repo,
      issueNumber,
      isPr,
      commentId: comment.id as number,
      commentBody: (comment.body as string) || "",
      commentUser: ((comment.user as Record<string, unknown>)?.login as string) || "",
      issueTitle: (issue.title as string) || "",
      issueBody: (issue.body as string) || "",
      senderLogin,
      senderId,
    };
  }

  if (eventType === "issues") {
    const issue = payload.issue as Record<string, unknown> | undefined;
    if (!issue) return null;
    return {
      eventType,
      action: (payload.action as string) || "",
      owner,
      repo,
      issueNumber: issue.number as number,
      isPr: false,
      issueTitle: (issue.title as string) || "",
      issueBody: (issue.body as string) || "",
      senderLogin,
      senderId,
    };
  }

  if (eventType === "pull_request" || eventType === "pull_request_review") {
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    if (!pr) return null;
    return {
      eventType,
      action: (payload.action as string) || "",
      owner,
      repo,
      issueNumber: pr.number as number,
      isPr: true,
      issueTitle: (pr.title as string) || "",
      issueBody: (pr.body as string) || "",
      senderLogin,
      senderId,
    };
  }

  if (eventType === "pull_request_review_comment") {
    const comment = payload.comment as Record<string, unknown> | undefined;
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    if (!comment || !pr) return null;
    return {
      eventType,
      action: (payload.action as string) || "",
      owner,
      repo,
      issueNumber: pr.number as number,
      isPr: true,
      commentId: comment.id as number,
      commentBody: (comment.body as string) || "",
      commentUser: ((comment.user as Record<string, unknown>)?.login as string) || "",
      issueTitle: (pr.title as string) || "",
      issueBody: (pr.body as string) || "",
      senderLogin,
      senderId,
    };
  }

  return null;
}

export type WebhookResult =
  | { kind: "ignored"; reason: string }
  | { kind: "forwarded"; event: RawInboundEvent };

export async function processWebhookPayload(params: {
  body: string;
  signature: string;
  eventHeader: string;
}): Promise<WebhookResult> {
  const { body, signature } = params;

  const workspaces = getGitHubWorkspaces();
  if (workspaces.length === 0) {
    return { kind: "ignored", reason: "no_github_workspaces_configured" };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return { kind: "ignored", reason: "invalid_json" };
  }

  const eventType = parseEventType({
    "x-github-event": params.eventHeader,
  });
  if (!eventType) {
    return { kind: "ignored", reason: "unsupported_event" };
  }

  // Verify signature against any workspace's webhook secret
  let verified = false;
  for (const ws of workspaces) {
    if (ws.webhookSecret && verifySignature(body, signature, ws.webhookSecret)) {
      verified = true;
      break;
    }
  }
  if (!verified) {
    return { kind: "ignored", reason: "signature_mismatch" };
  }

  const parsed = parsePayload(eventType, payload);
  if (!parsed) {
    return { kind: "ignored", reason: "unparseable_payload" };
  }

  const repoKey = `${parsed.owner}/${parsed.repo}`;
  const configuredRepos = getGitHubTargetRepos();
  if (configuredRepos && !configuredRepos.includes(repoKey)) {
    return { kind: "ignored", reason: "repo_not_configured" };
  }

  const ws = getWorkspaceForRepo(parsed.owner, parsed.repo);
  if (!ws) {
    return { kind: "ignored", reason: "no_workspace_for_repo" };
  }

  // Only process issue_comment created events for @-mentions
  if (eventType === "issue_comment" && parsed.action === "created" && parsed.commentBody) {
    const mentioned = isBotMentioned(parsed.commentBody, ws.botName);
    if (!mentioned) {
      return { kind: "ignored", reason: "bot_not_mentioned" };
    }

    // Skip bot's own comments
    if (parsed.commentUser?.toLowerCase() === "github-actions[bot]" || parsed.commentUser === ws.botName) {
      return { kind: "ignored", reason: "self_comment" };
    }

    const normalizedText = cleanBotMention(parsed.commentBody, ws.botName);
    const channelId = repoKey;
    const threadId = String(parsed.issueNumber);
    const processorId = createProcessorId("github", ws.token);
    const active = isThreadActive(channelId, threadId, processorId);
    const threadSession = loadSession(channelId, threadId);

    const event: RawInboundEvent = {
      platform: "github",
      botId: processorId,
      channelId,
      rawChannelId: channelId,
      threadId,
      replyThreadId: threadId,
      messageId: String(parsed.commentId),
      userId: String(parsed.senderId),
      selfMessage: false,
      threadOwnerMessage: isSyntheticOwner(threadSession?.threadOwnerUserId)
        || threadSession?.threadOwnerUserId === String(parsed.senderId),
      isTopLevel: false,
      hasAnyMention: true,
      mentionedBot: true,
      activeThread: active,
      ambientMode: false,
      rawText: parsed.commentBody,
      normalizedText,
      receivedAtMs: Date.now(),
    };

    markThreadActive(channelId, threadId, processorId);
    log.debug("GitHub webhook event forwarded to runtime", {
      repo: repoKey,
      issue: parsed.issueNumber,
      commentId: parsed.commentId,
      sender: parsed.senderLogin,
    });
    return { kind: "forwarded", event };
  }

  return { kind: "ignored", reason: `unhandled_event:${eventType}/${parsed.action}` };
}
