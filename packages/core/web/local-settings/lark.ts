import {
  readDashboardConfig,
  updateDashboardConfig,
} from "@/config";
import { normalizeChannelAgentProvider, resolveFallbackModel, type WorkspaceConfig } from "./shared";

type LarkTenantAccessTokenResponse = {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
};

type LarkTenantInfoResponse = {
  code?: number;
  msg?: string;
  data?: {
    tenant?: {
      name?: string;
    };
  };
};

type LarkChatListResponse = {
  code?: number;
  msg?: string;
  data?: {
    items?: Array<{
      chat_id?: string;
      name?: string;
    }>;
  };
};

const larkJsonRequest = async <T>(
  path: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(`https://open.feishu.cn${path}`, {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Lark API ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
};

const getLarkTenantAccessToken = async (appId: string, appSecret: string): Promise<string> => {
  const result = await larkJsonRequest<LarkTenantAccessTokenResponse>(
    "/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );

  if ((result.code ?? -1) !== 0 || !result.tenant_access_token) {
    throw new Error(result.msg || "Failed to get Lark tenant access token");
  }

  return result.tenant_access_token;
};

const larkAuthedRequest = async <T>(token: string, path: string): Promise<T> => {
  const result = await larkJsonRequest<T & { code?: number; msg?: string }>(path, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const record = result as { code?: number; msg?: string };
  if ((record.code ?? -1) !== 0) {
    throw new Error(record.msg || "Lark API error");
  }
  return result;
};

function buildLarkChannelDetails(
  chats: Array<{ chat_id?: string; name?: string }>,
  workspace: WorkspaceConfig | null,
  fallbackModel: string
): WorkspaceConfig["channelDetails"] {
  return chats
    .filter((chat) => typeof chat.chat_id === "string" && chat.chat_id.trim().length > 0)
    .map((chat) => {
      const chatId = chat.chat_id!.trim();
      const existing = workspace?.channelDetails.find((item) => item.id === chatId);
      const agentProvider = normalizeChannelAgentProvider(existing?.agentProvider);
      return {
        id: chatId,
        name: chat.name?.trim() || chatId,
        agentProvider,
        model: existing?.model ?? resolveFallbackModel(agentProvider, fallbackModel),
        workingDirectory: existing?.workingDirectory ?? "",
        baseBranch: existing?.baseBranch?.trim() ? existing.baseBranch.trim() : "main",
        channelSystemMessage: existing?.channelSystemMessage ?? "",
      };
    });
}

export const discoverLarkWorkspace = async (
  larkAppKey: string,
  larkAppSecret: string
): Promise<WorkspaceConfig> => {
  const appId = larkAppKey.trim();
  const appSecret = larkAppSecret.trim();
  if (!appId) {
    throw new Error("Missing Lark app key");
  }
  if (!appSecret) {
    throw new Error("Missing Lark app secret");
  }

  const config = readDashboardConfig();
  const tenantAccessToken = await getLarkTenantAccessToken(appId, appSecret);
  let tenantInfo: LarkTenantInfoResponse = {};
  let chatsResult: LarkChatListResponse = {};
  try {
    tenantInfo = await larkAuthedRequest<LarkTenantInfoResponse>(
      tenantAccessToken,
      "/open-apis/tenant/v2/tenant/query"
    );
  } catch {
    tenantInfo = {};
  }
  try {
    chatsResult = await larkAuthedRequest<LarkChatListResponse>(
      tenantAccessToken,
      "/open-apis/im/v1/chats?page_size=100"
    );
  } catch {
    chatsResult = {};
  }
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const channelDetails = buildLarkChannelDetails(chatsResult.data?.items ?? [], null, fallbackModel);
  const workspaceName =
    tenantInfo.data?.tenant?.name?.trim()
    || `Lark ${appId.slice(0, 8)}`;

  return {
    id: `lark-${appId}`,
    type: "lark",
    name: workspaceName,
    domain: "larksuite.com",
    status: "active",
    channels: channelDetails.length,
    members: 0,
    lastSync: new Date().toISOString(),
    larkAppKey: appId,
    larkAppId: appId,
    larkAppSecret: appSecret,
    channelDetails,
  };
};

export const syncLarkWorkspace = async (workspaceId: string): Promise<WorkspaceConfig> => {
  const config = readDashboardConfig();
  const workspaceIndex = config.workspaces.findIndex((item) => item.id === workspaceId);
  if (workspaceIndex === -1) {
    throw new Error("Workspace not found");
  }

  const workspace = config.workspaces[workspaceIndex]!;
  if (workspace.type !== "lark") {
    throw new Error("Workspace is not Lark type");
  }

  const appId = workspace.larkAppKey?.trim() || workspace.larkAppId?.trim() || "";
  const appSecret = workspace.larkAppSecret?.trim() ?? "";
  if (!appId || !appSecret) {
    throw new Error("Missing Lark app credentials");
  }

  const token = await getLarkTenantAccessToken(appId, appSecret);
  let tenantInfo: LarkTenantInfoResponse = {};
  try {
    tenantInfo = await larkAuthedRequest<LarkTenantInfoResponse>(token, "/open-apis/tenant/v2/tenant/query");
  } catch {
    tenantInfo = {};
  }
  let chatsResult: LarkChatListResponse = {};
  try {
    chatsResult = await larkAuthedRequest<LarkChatListResponse>(token, "/open-apis/im/v1/chats?page_size=100");
  } catch {
    chatsResult = {};
  }
  const fallbackModel = config.agents.opencode.models[0] ?? "";
  const channelDetails = buildLarkChannelDetails(chatsResult.data?.items ?? [], workspace, fallbackModel);

  const updatedWorkspace: WorkspaceConfig = {
    ...workspace,
    type: "lark",
    name: tenantInfo.data?.tenant?.name?.trim() || workspace.name,
    channels: channelDetails.length,
    lastSync: new Date().toISOString(),
    channelDetails,
  };

  updateDashboardConfig((current) => ({
    ...current,
    workspaces: current.workspaces.map((item, index) =>
      index === workspaceIndex ? updatedWorkspace : item
    ),
  }));
  return updatedWorkspace;
};
