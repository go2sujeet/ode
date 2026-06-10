import { describe, expect, it } from "bun:test";
import {
  buildMeaningfulThreadName,
  cleanBotMention,
  formatThreadNameFromBranch,
  formatThreadNameFromStatusTitle,
  markdownToDiscord,
  splitForDiscord,
} from "@/ims/discord/utils/message-utils";
import { isDiscordRateLimitErrorMessage, parseDiscordRetryAfterMs } from "@/ims/discord/utils/rate-limit";

describe("discord message utilities", () => {
  it("splits oversized content by limit", () => {
    const chunks = splitForDiscord("abcdef", 2);
    expect(chunks).toEqual(["ab", "cd", "ef"]);
  });

  it("keeps standard markdown unchanged for Discord", () => {
    expect(markdownToDiscord("**bold** _italic_ `code`")).toBe("**bold** _italic_ `code`");
  });

  it("normalizes mention and thread names", () => {
    expect(cleanBotMention("<@123> hello <@!123>", "123")).toBe("hello");
    expect(buildMeaningfulThreadName("hello\nworld", 8)).toBe("hello wo");
    expect(formatThreadNameFromBranch(" feat/my branch ", 20)).toBe("feat/my-branch");
    expect(formatThreadNameFromStatusTitle("  ## title\nline", 10)).toBe("title line");
  });

  it("parses rate limit error shapes", () => {
    expect(isDiscordRateLimitErrorMessage("HTTP 429")).toBe(true);
    expect(parseDiscordRetryAfterMs({ retry_after: 1.2 })).toBe(1200);
    expect(parseDiscordRetryAfterMs({ message: "retry after 2" })).toBe(2000);
  });
});
