import { log } from "@/utils";

export type GitHubComment = {
  id: number;
  body: string;
  user: { login: string; id: number };
  created_at: string;
  updated_at: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  user: { login: string; id: number };
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  body: string;
  state: string;
  html_url: string;
  user: { login: string; id: number };
};

export type GitHubRepo = {
  owner: string;
  repo: string;
};

export function parseRepoFullName(fullName: string): GitHubRepo {
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid GitHub repo format: ${fullName} (expected owner/repo)`);
  }
  return { owner: parts[0]!, repo: parts[1]! };
}

const GITHUB_API = "https://api.github.com";

export function buildHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github.v3+json",
    "user-agent": "ode-github-bot",
  };
}

export async function createComment(params: {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<number> {
  const { token, owner, repo, issueNumber, body } = params;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${text}`);
  }
  const data = (await response.json()) as { id: number };
  log.debug("GitHub comment created", { owner, repo, issueNumber, commentId: data.id });
  return data.id;
}

export async function updateComment(params: {
  token: string;
  owner: string;
  repo: string;
  commentId: number;
  body: string;
}): Promise<void> {
  const { token, owner, repo, commentId, body } = params;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${commentId}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: buildHeaders(token),
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${text}`);
  }
  log.debug("GitHub comment updated", { owner, repo, commentId });
}

export async function deleteComment(params: {
  token: string;
  owner: string;
  repo: string;
  commentId: number;
}): Promise<void> {
  const { token, owner, repo, commentId } = params;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/comments/${commentId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: buildHeaders(token),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${text}`);
  }
  log.debug("GitHub comment deleted", { owner, repo, commentId });
}

export async function getIssueComments(params: {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
}): Promise<GitHubComment[]> {
  const { token, owner, repo, issueNumber } = params;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`;
  const response = await fetch(url, { headers: buildHeaders(token) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${text}`);
  }
  return response.json() as Promise<GitHubComment[]>;
}

export async function getIssue(params: {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
}): Promise<GitHubIssue> {
  const { token, owner, repo, issueNumber } = params;
  const url = `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`;
  const response = await fetch(url, { headers: buildHeaders(token) });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${text}`);
  }
  return response.json() as Promise<GitHubIssue>;
}
