import { getWorkspaces } from "@/config";

export function validateWorkspaceConfig(config: {
  workspaces: Array<{
    id: string;
    type: "slack" | "discord" | "lark" | "github";
    name: string;
    slackAppToken?: string;
    slackBotToken?: string;
    discordBotToken?: string;
    larkAppKey?: string;
    larkAppId?: string;
    larkAppSecret?: string;
  }>;
}): string | null {
  const idCounts = new Map<string, number>();
  const slackBotTokenCounts = new Map<string, number>();
  const discordBotTokenCounts = new Map<string, number>();
  const larkAppKeyCounts = new Map<string, number>();
  for (const workspace of config.workspaces) {
    const workspaceId = workspace.id.trim();
    if (!workspaceId) {
      return "Workspace id is required for every workspace";
    }
    idCounts.set(workspaceId, (idCounts.get(workspaceId) ?? 0) + 1);
    if (workspace.type === "discord") {
      const botToken = workspace.discordBotToken?.trim() ?? "";
      if (!botToken) {
        const label = workspace.name.trim() || workspace.id;
        return `Missing Discord bot token for workspace: ${label}`;
      }
      discordBotTokenCounts.set(botToken, (discordBotTokenCounts.get(botToken) ?? 0) + 1);
      continue;
    }

    if (workspace.type === "lark") {
      const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim() || "";
      const appSecret = workspace.larkAppSecret?.trim() ?? "";
      if (!appId || !appSecret) {
        const label = workspace.name.trim() || workspace.id;
        return `Missing Lark app key/app secret for workspace: ${label}`;
      }
      larkAppKeyCounts.set(appId, (larkAppKeyCounts.get(appId) ?? 0) + 1);
      continue;
    }

    const appToken = workspace.slackAppToken?.trim() ?? "";
    const botToken = workspace.slackBotToken?.trim() ?? "";
    if (!appToken || !botToken) {
      const label = workspace.name.trim() || workspace.id;
      return `Missing Slack app/bot token for workspace: ${label}`;
    }
    slackBotTokenCounts.set(botToken, (slackBotTokenCounts.get(botToken) ?? 0) + 1);
  }

  const duplicateIds = Array.from(idCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicateIds.length > 0) {
    return `Duplicate workspace ids: ${duplicateIds.join(", ")}`;
  }

  const duplicateSlackBotTokenCount = Array.from(slackBotTokenCounts.values()).filter((count) => count > 1).length;
  if (duplicateSlackBotTokenCount > 0) {
    return "Duplicate Slack bot tokens found across workspaces";
  }

  const duplicateDiscordBotTokenCount = Array.from(discordBotTokenCounts.values()).filter((count) => count > 1).length;
  if (duplicateDiscordBotTokenCount > 0) {
    return "Duplicate Discord bot tokens found across workspaces";
  }

  const duplicateLarkAppKeyCount = Array.from(larkAppKeyCounts.values()).filter((count) => count > 1).length;
  if (duplicateLarkAppKeyCount > 0) {
    return "Duplicate Lark app keys found across workspaces";
  }

  return null;
}

function getDiscordWorkspaceTokenByChannel(channelId: string): string | undefined {
  if (!channelId) return undefined;
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "discord") continue;
    const token = workspace.discordBotToken?.trim();
    if (!token) continue;
    if (workspace.channelDetails.some((channel) => channel.id === channelId)) {
      return token;
    }
  }
  return undefined;
}

function getDiscordWorkspaceTokenByGuild(guildId: string): string | undefined {
  if (!guildId) return undefined;
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "discord") continue;
    const token = workspace.discordBotToken?.trim();
    if (!token) continue;
    if (workspace.id === guildId) {
      return token;
    }
  }
  return undefined;
}

function resolveDiscordBotTokenFromConfig(payload: Record<string, unknown>): string | undefined {
  const channelId = typeof payload.channelId === "string" ? payload.channelId.trim() : "";
  if (channelId) {
    const channelToken = getDiscordWorkspaceTokenByChannel(channelId);
    if (channelToken) return channelToken;
  }

  const guildId = typeof payload.guildId === "string" ? payload.guildId.trim() : "";
  if (guildId) {
    const guildToken = getDiscordWorkspaceTokenByGuild(guildId);
    if (guildToken) return guildToken;
  }

  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "discord") continue;
    const token = workspace.discordBotToken?.trim();
    if (token) return token;
  }

  return undefined;
}

export function attachDiscordBotToken(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  const resolved = resolveDiscordBotTokenFromConfig(record);
  if (resolved) {
    record.botToken = resolved;
  }
}

function getLarkWorkspaceCredentialsByChannel(channelId: string): { appId: string; appSecret: string } | undefined {
  if (!channelId) return undefined;
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "lark") continue;
    const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim();
    const appSecret = workspace.larkAppSecret?.trim();
    if (!appId || !appSecret) continue;
    if (workspace.channelDetails.some((channel) => channel.id === channelId)) {
      return { appId, appSecret };
    }
  }
  return undefined;
}

function getLarkWorkspaceCredentialsByWorkspace(workspaceId: string): { appId: string; appSecret: string } | undefined {
  if (!workspaceId) return undefined;
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "lark") continue;
    const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim();
    const appSecret = workspace.larkAppSecret?.trim();
    if (!appId || !appSecret) continue;
    if (workspace.id === workspaceId) {
      return { appId, appSecret };
    }
  }
  return undefined;
}

export function attachLarkCredentials(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;

  const channelId = typeof record.channelId === "string" ? record.channelId.trim() : "";
  if (channelId) {
    const byChannel = getLarkWorkspaceCredentialsByChannel(channelId);
    if (byChannel) {
      record.appId = byChannel.appId;
      record.appSecret = byChannel.appSecret;
      return;
    }
  }

  const workspaceId = typeof record.workspaceId === "string" ? record.workspaceId.trim() : "";
  if (workspaceId) {
    const byWorkspace = getLarkWorkspaceCredentialsByWorkspace(workspaceId);
    if (byWorkspace) {
      record.appId = byWorkspace.appId;
      record.appSecret = byWorkspace.appSecret;
      return;
    }
  }

  const first = getWorkspaces().find((workspace) => workspace.type === "lark");
  if (first) {
    const appId = first.larkAppKey?.trim() || first.larkAppId?.trim();
    const appSecret = first.larkAppSecret?.trim();
    if (appId && appSecret) {
      record.appId = appId;
      record.appSecret = appSecret;
    }
  }
}
