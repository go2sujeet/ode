import {
  getChannelAgentsMd,
  getChannelAgentInstructions,
} from "@/config/local/settings";
import type { OpenCodeMessageContext, OpenCodeOptions, PromptPart, SlackContext } from "./types";
import { getSlackActionApiUrl } from "@/config";

export function buildSystemPrompt(slack?: SlackContext): string {
  const platform = slack?.platform === "discord" ? "discord" : "slack";
  const platformLabel = platform === "discord" ? "Discord" : "Slack";
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
    lines.push(`${platformLabel.toUpperCase()} ACTIONS:`);
    const baseUrl = slack.odeSlackApiUrl ?? getSlackActionApiUrl();
    if (platform === "slack" && slack.hasCustomSlackTool) {
      lines.push("- Use `ode_action` tool for Slack actions (messages, reactions, thread history, questions, uploads).");
    } else {
      lines.push("- Use bash + curl to call the Ode action API.");
      lines.push(`- Endpoint: ${baseUrl}/action`);
      lines.push(
        platform === "discord"
          ? "- Payload: {\"platform\":\"discord\",\"action\":\"post_message\",\"channelId\":\"...\",\"messageId\":\"...\",\"text\":\"...\"}"
          : "- Payload: {\"action\":\"post_message\",\"channelId\":\"...\",\"threadId\":\"...\",\"messageId\":\"...\",\"text\":\"...\"}"
      );
    }
    if (platform === "discord") {
      lines.push("- Supported actions: get_guilds, get_channels, post_message, update_message, create_thread_from_message, get_thread_messages, ask_user, add_reaction, get_user_info, upload_file.");
      lines.push("- Required fields: channelId for message/reaction/question/upload actions; threadId for get_thread_messages; messageId + emoji for reactions; userId (or \"@me\") for get_user_info; filePath for upload_file.");
      lines.push("- add_reaction schema: { platform: \"discord\", action: \"add_reaction\", channelId: string, messageId: string, emoji: \"thumbsup\" | \"eyes\" | \"ok_hand\" }");
    } else {
      lines.push("- Supported actions: post_message, add_reaction, get_thread_messages, ask_user, get_user_info, upload_file.");
      lines.push("- Required fields: channelId; threadId for thread actions; messageId + emoji for reactions; userId for get_user_info.");
      lines.push("- add_reaction schema: { action: \"add_reaction\", channelId: string, messageId: string, emoji: \"thumbsup\" | \"eyes\" | \"ok_hand\" }");
    }
    lines.push("- You can use any tool available via bash, curl");
    lines.push("");
    lines.push(`IMPORTANT: Your text output is automatically posted to ${platformLabel}.`);
    lines.push(
      platform === "discord"
        ? "- When asking the user to choose options, use ask_user action and do NOT also output text - the posted question is enough."
        : "- When asking the user to choose options, you can send an ask_user Slack action, do NOT also output text - the buttons are enough."
    );
    lines.push("- Only output text OR use a messaging tool, never both.");
    lines.push("");
    lines.push("FORMATTING:");
    lines.push(
      platform === "discord"
        ? "- Discord supports markdown like **bold**, _italic_, and code fences."
        : "- Slack uses *bold* and _italic_ (not **bold** or *italic*)"
    );
    lines.push("- Use ` for inline code and ``` for code blocks");
    lines.push("- Keep responses readable on mobile screens");
    lines.push("");
    lines.push("TASK LISTS:");
    lines.push("- When sharing tasks, put each item on its own line");
    lines.push("- Use four states: * not started, ♻️ in progress, ✅ done, 🚫 cancelled");
    lines.push("- If you include a task list, keep the tasks you have done at the top of the response");

    const channelSystemMessage = slack.channelSystemMessage?.trim();
    if (channelSystemMessage) {
      lines.push("");
      lines.push(channelSystemMessage);
    }
  }

  return lines.join("\n");
}

export function buildPromptParts(
  channelId: string,
  message: string,
  options?: OpenCodeOptions,
  context?: OpenCodeMessageContext
): PromptPart[] {
  const parts: PromptPart[] = [];

  const agent = options?.agent;
  const agentsMd = getChannelAgentsMd(channelId);
  const agentInstructions =
    agent === "plan" || agent === "build"
      ? getChannelAgentInstructions(channelId, agent)
      : null;
  const combinedInstructions = [agentsMd, agentInstructions]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n\n");

  if (combinedInstructions) {
    parts.push({
      type: "text",
      text: `<channel-instructions>\n${combinedInstructions}\n</channel-instructions>`,
    });
  }

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
