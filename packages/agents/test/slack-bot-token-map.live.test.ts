import { describe, it } from "bun:test";
import { WebClient } from "@slack/web-api";
import { getSlackAppTokens, getSlackBotTokens } from "@/config";
import { log } from "@/utils";

function truncateToken(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

describe("slack bot token map", () => {
  it("logs team and enterprise ids for configured bot tokens", async () => {
    const appTokens = getSlackAppTokens();
    const uniqueAppTokens = Array.from(new Set(appTokens.map((entry) => entry.token).filter(Boolean)));
    const tokens = getSlackBotTokens()
      .map((entry) => ({
        botToken: entry.token,
        workspaceName: entry.workspaceName ?? null,
      }))
      .filter((entry) => entry.botToken && entry.botToken.trim().length > 0);

    if (tokens.length === 0) {
      log.warn("No configured bot tokens found for slack test");
      return;
    }

    const results: Array<Record<string, string | null>> = [];

    for (const token of tokens) {
      if (!token.botToken) continue;

      const client = new WebClient(token.botToken);
      try {
        const auth = await client.auth.test();
        results.push({
          workspaceName: token.workspaceName ?? null,
          botToken: truncateToken(token.botToken),
          teamId: (auth as any).team_id ?? null,
          enterpriseId: (auth as any).enterprise_id ?? null,
          botId: (auth as any).bot_id ?? null,
          userId: (auth as any).user_id ?? null,
          appId: (auth as any).app_id ?? null,
        });
      } catch (err) {
        results.push({
          workspaceName: token.workspaceName ?? null,
          botToken: truncateToken(token.botToken),
          teamId: null,
          enterpriseId: null,
          botId: null,
          userId: null,
          appId: null,
        });
        log.error("auth.test failed for bot token", {
          botToken: truncateToken(token.botToken),
          workspaceName: token.workspaceName ?? null,
          error: String(err),
        });
      }
    }

    console.log(results)
    log.info("Slack bot token mapping", {
      appTokens: uniqueAppTokens.map((token) => truncateToken(token)),
      count: results.length,
      results,
    });
  });
});
