import { RuntimeCache } from "@/shared/cache/runtime-cache";

export type WorkspaceAuth = {
  appToken: string;
  botToken: string;
  workspaceId: string;
  workspaceName: string;
  teamId: string | null;
  enterpriseId: string | null;
  botUserId: string | null;
  botId: string | null;
  userId: string | null;
};

export class SlackAuthRegistry {
  private readonly workspaceAuthMap = new RuntimeCache<string, WorkspaceAuth>({ max: 200, ttlMs: 24 * 60 * 60 * 1000 });
  private readonly botTokenAuthMap = new RuntimeCache<string, WorkspaceAuth>({ max: 200, ttlMs: 24 * 60 * 60 * 1000 });
  private readonly appTokenAuthMap = new RuntimeCache<string, WorkspaceAuth>({ max: 200, ttlMs: 24 * 60 * 60 * 1000 });
  private readonly channelWorkspaceMap = new RuntimeCache<string, string>({ max: 2000, ttlMs: 24 * 60 * 60 * 1000 });
  private readonly channelWorkspaceAuthMap = new RuntimeCache<string, WorkspaceAuth>({ max: 2000, ttlMs: 24 * 60 * 60 * 1000 });
  private readonly threadBotTokenMap = new RuntimeCache<string, string>({ max: 6000, ttlMs: 24 * 60 * 60 * 1000 });
  private readonly messageBotTokenMap = new RuntimeCache<string, string>({ max: 20000, ttlMs: 24 * 60 * 60 * 1000 });

  clear(): void {
    this.workspaceAuthMap.clear();
    this.botTokenAuthMap.clear();
    this.appTokenAuthMap.clear();
    this.channelWorkspaceMap.clear();
    this.channelWorkspaceAuthMap.clear();
    this.threadBotTokenMap.clear();
    this.messageBotTokenMap.clear();
  }

  resolveWorkspaceAuth(credentialKey?: string): WorkspaceAuth | undefined {
    if (!credentialKey) return undefined;
    return this.workspaceAuthMap.get(credentialKey) ?? this.botTokenAuthMap.get(credentialKey);
  }

  getWorkspaceAuthByAppToken(appToken: string): WorkspaceAuth | undefined {
    return this.appTokenAuthMap.get(appToken);
  }

  registerWorkspaceAuth(auth: WorkspaceAuth): void {
    this.workspaceAuthMap.set(auth.workspaceId, auth);
    this.botTokenAuthMap.set(auth.botToken, auth);
    this.appTokenAuthMap.set(auth.appToken, auth);
  }

  setChannelWorkspaceName(channelId: string, workspaceName: string): void {
    this.channelWorkspaceMap.set(channelId, workspaceName);
  }

  getChannelWorkspaceName(channelId: string): string | undefined {
    return this.channelWorkspaceMap.get(channelId);
  }

  setChannelWorkspaceAuthByBotToken(channelId: string, botToken: string): void {
    const fullAuth = this.botTokenAuthMap.get(botToken);
    if (fullAuth) this.channelWorkspaceAuthMap.set(channelId, fullAuth);
  }

  getChannelWorkspaceBotToken(channelId: string): string | undefined {
    return this.channelWorkspaceAuthMap.get(channelId)?.botToken;
  }

  setThreadBotToken(channelId: string, threadId: string, botToken: string): void {
    if (!channelId || !threadId || !botToken) return;
    this.threadBotTokenMap.set(`${channelId}:${threadId}`, botToken);
  }

  setMessageBotToken(channelId: string, messageTs: string, botToken: string): void {
    if (!channelId || !messageTs || !botToken) return;
    this.messageBotTokenMap.set(`${channelId}:${messageTs}`, botToken);
  }

  getMessageBotToken(channelId: string, messageTs: string): string | undefined {
    return this.messageBotTokenMap.get(`${channelId}:${messageTs}`);
  }

  getThreadBotToken(channelId: string, threadId: string): string | undefined {
    return this.threadBotTokenMap.get(`${channelId}:${threadId}`);
  }

  findBotTokenByProcessorId(processorId: string, toProcessorId: (botToken: string) => string): string | undefined {
    for (const entry of this.botTokenAuthMap.values()) {
      if (toProcessorId(entry.botToken) === processorId) {
        return entry.botToken;
      }
    }
    return undefined;
  }

  getFirstRegisteredBotToken(): string | undefined {
    const registered = this.workspaceAuthMap.values().next().value as WorkspaceAuth | undefined;
    return registered?.botToken;
  }
}
