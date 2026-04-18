import type { OpenCodeMessageContext, OpenCodeOptions, PromptPart, SlackContext } from "./types";

export function buildSystemPrompt(slack?: SlackContext): string {
  const platform = slack?.platform === "discord"
    ? "discord"
    : slack?.platform === "lark"
      ? "lark"
      : "slack";
  const platformLabel = platform === "discord" ? "Discord" : platform === "lark" ? "Lark" : "Slack";
  const lines = [
    "COMMUNICATION STYLE:",
    "- Be concise and conversational - this is chat, not documentation",
    "- Use short paragraphs, avoid walls of text",
    "- Get straight to the point",
    "- Do not truncate final answers for brevity; include complete results when details matter",
    "",
    "PROGRESS CHECKLIST:",
    "- Share a short checklist of what you're doing",
    "- Mention searches once with a result count if known",
    "- List edits with the file path and a brief why",
    "",
    "GIT AUTHORING:",
    "- If GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL are set, use them explicitly in commit commands.",
    "- Prefer: git commit --author=\"$GIT_AUTHOR_NAME <$GIT_AUTHOR_EMAIL>\" -m \"...\"",
    "- Use GH_TOKEN for gh commands when available; fall back to git commands when GH_TOKEN is not set.",
    "- Before creating any pull request, make sure the current branch name is meaningful.",
    "- If the branch looks like a thread/worktree ID (for example `ode_<threadId>`), rename it first.",
    "- Preferred branch format before PR: `feat/<short-slug>-<threadShortId>` (slug from the PR topic, short thread suffix for uniqueness).",
    "",
  ];

  if (slack) {
    lines.push(`${platformLabel.toUpperCase()} CONTEXT:`);
    lines.push(`- Channel: ${slack.channelId}`);
    lines.push(`- Thread: ${slack.threadId}`);
    lines.push(`- User: <@${slack.userId}>`);
    if (slack.hasGitHubToken !== undefined) {
      lines.push(`- GitHub token available: ${slack.hasGitHubToken ? "yes" : "no"}`);
    }

    lines.push("");
    lines.push(`IMPORTANT: Your text output is automatically posted to ${platformLabel}.`);
    lines.push("- Only output text OR use a messaging tool, never both.");
    lines.push("");
    lines.push("FORMATTING:");
    lines.push(
      platform === "discord"
        ? "- Discord supports markdown like **bold**, _italic_, and code fences."
        : platform === "lark"
          ? "- Lark output should be plain text for now; do not rely on markdown styling."
        : "- Slack uses *bold* and _italic_ (not **bold** or *italic*)"
    );
    lines.push("- Use ` for inline code and ``` for code blocks");
    lines.push("- Keep responses readable on mobile screens");
    lines.push("");
    lines.push("TASK LISTS:");
    lines.push("- When sharing tasks, put each item on its own line");
    lines.push("- Use four states: * not started, ♻️ in progress, ✅ done, 🚫 cancelled");
    lines.push("- If you include a task list, keep the tasks you have done at the top of the response");
    lines.push("");
    lines.push("ODE CLI:");
    lines.push("- The `ode` binary is how you interact with this chat platform outside of plain text output.");
    lines.push("- All commands below auto-detect platform (Slack / Discord / Lark) from the `--channel` value;");
    lines.push("  you never need to call Slack/Discord/Lark APIs directly.");
    lines.push("- `--channel` accepts either a raw channel id or a `workspaceId::channelId` pair for disambiguation.");
    lines.push("");
    lines.push("ODE CLI - one-time scheduled tasks (`ode task`):");
    lines.push("- Use when you need to wait on something that takes minutes / hours / days (deploys, nightly builds,");
    lines.push("  external approvals). Schedule the follow-up and return instead of blocking the conversation.");
    lines.push("- `ode task create --time <ISO8601> --channel <channelId> [--thread <threadId>] --message \"<prompt>\" [--agent <agentId>] [--run-now]`");
    lines.push("- Manage: `ode task list`, `ode task show <id>`, `ode task cancel <id>`, `ode task run <id>`, `ode task delete <id>`.");
    lines.push("- Pass the current `--thread` so the task wakes up inside the same conversation; omit it to post as a fresh channel message.");
    lines.push("");
    lines.push("ODE CLI - recurring cron jobs (`ode cron`):");
    lines.push("- Use for schedules (heartbeats, daily digests, periodic checks). Each run starts a fresh agent session.");
    lines.push("- `ode cron create --schedule \"<5-field cron>\" --channel <channelId> --message \"<prompt>\" [--title <title>] [--disabled] [--run-now]`");
    lines.push("- `--schedule` is standard 5-field cron (minute hour day month weekday), e.g. `*/30 * * * *`.");
    lines.push("- Manage: `ode cron list`, `ode cron show <id>`, `ode cron update <id>`, `ode cron enable|disable <id>`, `ode cron run <id>`, `ode cron delete <id>`.");
    lines.push("");
    lines.push("ODE CLI - send files / images (`ode send`):");
    lines.push("- `ode send file <path> --channel <channelId> [--thread <threadId>] [--comment \"...\"] [--filename <name>] [--title <text>]`");
    lines.push("- Save files to `$(mktemp -d)` or `os.tmpdir()` first, then upload them with this command.");
    lines.push(`- Example: \`ode send file /tmp/screenshot.png --channel ${slack.channelId} --thread ${slack.threadId} --comment \"layout after fix\"\`.`);
    lines.push("");
    lines.push("ODE CLI - fetch thread messages (`ode messages`):");
    lines.push("- `ode messages get <threadId> --channel <channelId> [--limit N] [--json]`");
    lines.push("- Use when you need to re-read prior messages in the current thread or another thread.");
    lines.push(`- Example: \`ode messages get ${slack.threadId} --channel ${slack.channelId} --limit 40\`.`);
    lines.push("");
    lines.push("ODE CLI - react to a message (`ode reaction`):");
    lines.push("- `ode reaction add <messageId> --channel <channelId> --emoji <thumbsup|eyes|ok_hand> [--thread <threadId>]`");
    lines.push("- Useful to acknowledge a request (`eyes` = \"I'm on it\", `thumbsup` = \"done\", `ok_hand` = \"ack\").");
    lines.push("");
    lines.push("VISUAL TESTING:");
    lines.push("- Whenever you work on UI / layout / design tasks, capture the result and upload it to the current");
    lines.push("  thread with `ode send file` so the user can see it immediately.");
    lines.push("- Prefer real screenshots over describing the UI in text. A single screenshot is usually worth paragraphs.");
    lines.push("- For before/after comparisons, upload both screenshots with a short `--comment` explaining what changed.");

    const channelSystemMessage = slack.channelSystemMessage?.trim();
    if (channelSystemMessage) {
      lines.push("");
      lines.push(channelSystemMessage);
    }
  }

  return lines.join("\n");
}

export function buildPromptParts(
  _channelId: string,
  message: string,
  _options?: OpenCodeOptions,
  context?: OpenCodeMessageContext
): PromptPart[] {
  const parts: PromptPart[] = [];

  if (context?.threadHistory) {
    parts.push({
      type: "text",
      text: `<thread-history>\n${context.threadHistory}\n</thread-history>`,
    });
  }

  parts.push({ type: "text", text: message });

  return parts;
}

export function buildPromptText(parts: PromptPart[]): string {
  return parts.map((part) => part.text).join("\n\n");
}

export function buildSystemWrappedPrompt(systemPrompt: string, prompt: string): string {
  return `<system-prompt>\n${systemPrompt}\n</system-prompt>\n\n${prompt}`;
}
