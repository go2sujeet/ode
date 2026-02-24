import {
  getCodexModels,
  getChannelAgentProvider,
  getChannelBaseBranch,
  getChannelModel,
  getChannelSystemMessage,
  getEnabledAgentProviders,
  getGitHubInfoForUser,
  getKiloModels,
  getOpenCodeModels,
  STATUS_MESSAGE_FREQUENCY_OPTIONS,
  getUserGeneralSettings,
  getWebHost,
  getWebPort,
  getWorkspaces,
  resolveChannelCwd,
} from "@/config";

export type LarkSettingsCardAction =
  | "open_settings_launcher"
  | "open_general_settings_modal"
  | "open_settings_modal"
  | "open_github_token_modal"
  | "set_general_status_format"
  | "set_general_status_frequency"
  | "set_general_git_strategy"
  | "set_general_auto_update"
  | "set_channel_settings"
  | "set_github_info"
  | "clear_github_info";

const SETTINGS_LAUNCHER_ACTIONS: Array<{ action: LarkSettingsCardAction; label: string; style?: "primary" | "default" }> = [
  { action: "open_general_settings_modal", label: "General setting", style: "primary" },
  { action: "open_settings_modal", label: "Channel setting" },
  { action: "open_github_token_modal", label: "GitHub info" },
];

function toWorkspaceSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getWorkspaceNameByChannel(channelId: string): string {
  for (const workspace of getWorkspaces()) {
    if (workspace.type !== "lark") continue;
    if (workspace.channelDetails.some((detail) => detail.id === channelId)) {
      return workspace.name || "workspace";
    }
  }
  const fallback = getWorkspaces().find((workspace) => workspace.type === "lark");
  return fallback?.name || "workspace";
}

function getLocalSettingsUrl(): string {
  return `http://${getWebHost()}:${getWebPort()}/`;
}

function buildSettingsLauncherCard(channelId: string, threadId: string): Record<string, unknown> {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: "Ode Settings",
      },
    },
    elements: [
      {
        tag: "markdown",
        content: `Choose which settings page to open.\n\nChannel: \`${channelId}\``,
      },
      {
        tag: "action",
        actions: SETTINGS_LAUNCHER_ACTIONS.map((item) => ({
          tag: "button",
          text: {
            tag: "plain_text",
            content: item.label,
          },
          type: item.style ?? "default",
          value: {
            action: item.action,
            channelId,
            threadId,
          },
        })),
      },
    ],
  };
}

export function resolveLarkSettingsCardAction(value: unknown): LarkSettingsCardAction | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (
      normalized === "open_settings_launcher"
      || normalized === "open_general_settings_modal"
      || normalized === "open_settings_modal"
      || normalized === "open_github_token_modal"
      || normalized === "set_general_status_format"
      || normalized === "set_general_status_frequency"
      || normalized === "set_general_git_strategy"
      || normalized === "set_general_auto_update"
      || normalized === "set_channel_settings"
      || normalized === "set_github_info"
      || normalized === "clear_github_info"
    ) {
      return normalized;
    }
    return null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return resolveLarkSettingsCardAction(record.action ?? record.action_id ?? record.actionId ?? record.type);
  }

  return null;
}

function boolText(value: boolean): string {
  return value ? "On" : "Off";
}

function maskedToken(token: string | undefined): string {
  if (!token) return "(not set)";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function buildLarkSettingsDetailCard(params: {
  action: LarkSettingsCardAction;
  channelId: string;
  threadId: string;
  userId: string;
  notice?: string;
}): Record<string, unknown> {
  const { action, channelId, threadId, userId, notice } = params;
  const workspaceSlug = encodeURIComponent(toWorkspaceSlug(getWorkspaceNameByChannel(channelId)) || "workspace");
  const localSettingsUrl = getLocalSettingsUrl();
  const workspaceUrl = `${localSettingsUrl}slack-bot/${workspaceSlug}`;

  if (action === "open_general_settings_modal") {
    const general = getUserGeneralSettings();
    const statusFormatOptions = [
      { value: "minimum", label: "Minimum" },
      { value: "medium", label: "Medium" },
      { value: "aggressive", label: "Aggressive" },
    ];
    const gitOptions = [
      { value: "worktree", label: "Worktree" },
      { value: "default", label: "Default" },
    ];
    const autoUpdateOptions = [
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ];

    const elements: Array<Record<string, unknown>> = [];
    if (notice) {
      elements.push({
        tag: "markdown",
        content: `✅ ${notice}`,
      });
    }

    elements.push(
      {
        tag: "markdown",
        content: [
          `- Status format: \`${general.defaultStatusMessageFormat}\``,
          `- Status frequency: \`${general.statusMessageFrequencyMs / 1000}s\``,
          `- Git strategy: \`${general.gitStrategy}\``,
          `- Auto update: \`${boolText(general.autoUpdate)}\``,
        ].join("\n"),
      },
      {
        tag: "markdown",
        content: "Status format",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "select_static",
            placeholder: { tag: "plain_text", content: "Select format" },
            options: statusFormatOptions.map((item) => ({
              text: { tag: "plain_text", content: item.label },
              value: item.value,
            })),
            value: {
              action: "set_general_status_format",
              current: general.defaultStatusMessageFormat,
              channelId,
              threadId,
            },
          },
        ],
      },
      {
        tag: "markdown",
        content: "Status frequency",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "select_static",
            placeholder: { tag: "plain_text", content: "Select frequency" },
            options: STATUS_MESSAGE_FREQUENCY_OPTIONS.map((item) => ({
              text: { tag: "plain_text", content: item.label },
              value: String(item.ms),
            })),
            value: {
              action: "set_general_status_frequency",
              current: String(general.statusMessageFrequencyMs),
              channelId,
              threadId,
            },
          },
        ],
      },
      {
        tag: "markdown",
        content: "Git strategy",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "select_static",
            placeholder: { tag: "plain_text", content: "Select strategy" },
            options: gitOptions.map((item) => ({
              text: { tag: "plain_text", content: item.label },
              value: item.value,
            })),
            value: {
              action: "set_general_git_strategy",
              current: general.gitStrategy,
              channelId,
              threadId,
            },
          },
        ],
      },
      {
        tag: "markdown",
        content: "Auto update",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "select_static",
            placeholder: { tag: "plain_text", content: "Select auto update" },
            options: autoUpdateOptions.map((item) => ({
              text: { tag: "plain_text", content: item.label },
              value: item.value,
            })),
            value: {
              action: "set_general_auto_update",
              current: general.autoUpdate ? "on" : "off",
              channelId,
              threadId,
            },
          },
        ],
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            type: "primary",
            text: { tag: "plain_text", content: "Back" },
            value: { action: "open_settings_launcher", channelId, threadId },
          },
        ],
      }
    );

    return {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: "General setting" },
      },
      elements,
    };
  }

  if (action === "open_settings_modal") {
    const provider = getChannelAgentProvider(channelId);
    const model = getChannelModel(channelId) || "(not set)";
    const cwd = resolveChannelCwd(channelId).workingDirectory || "(not set)";
    const baseBranch = getChannelBaseBranch(channelId);
    const systemMessage = getChannelSystemMessage(channelId) || "(none)";
    const enabledProviders = getEnabledAgentProviders();
    const providerOptions = (enabledProviders.length > 0 ? enabledProviders : [
      "opencode",
      "claudecode",
      "codex",
      "kimi",
      "kiro",
      "kilo",
      "qwen",
      "goose",
      "gemini",
    ]).map((item) => ({
      text: { tag: "plain_text", content: item },
      value: item,
    }));
    const providerModels = provider === "codex"
      ? getCodexModels()
      : provider === "kilo"
        ? getKiloModels()
        : provider === "opencode"
          ? getOpenCodeModels()
          : [];
    const modelOptions = Array.from(new Set([...(model !== "(not set)" ? [model] : []), ...providerModels]))
      .filter((item) => item && item.trim().length > 0)
      .slice(0, 100)
      .map((item) => ({
        text: { tag: "plain_text", content: item },
        value: item,
      }));
    const workingDirectoryOptions = Array.from(new Set([
      cwd === "(not set)" ? "" : cwd,
      "/root/ode-new",
      "/root",
      "/",
    ])).map((item) => ({
      text: { tag: "plain_text", content: item || "(empty)" },
      value: item,
    }));
    const baseBranchOptions = Array.from(new Set([
      baseBranch,
      "main",
      "master",
      "develop",
      "dev",
    ])).map((item) => ({
      text: { tag: "plain_text", content: item || "main" },
      value: item || "main",
    }));
    const channelSystemMessageOptions = [
      { text: "(empty)", value: "" },
      { text: "concise", value: "Please keep responses concise and actionable." },
      { text: "detailed", value: "Please provide detailed reasoning and include implementation notes." },
      { text: "current", value: systemMessage === "(none)" ? "" : systemMessage },
    ]
      .filter((item, idx, all) => all.findIndex((x) => x.value === item.value) === idx)
      .map((item) => ({
        text: { tag: "plain_text", content: item.text },
        value: item.value,
      }));
    const settingsBaseValue = {
      action: "set_channel_settings",
      channelId,
      threadId,
      provider,
      model: model === "(not set)" ? "" : model,
      workingDirectory: cwd === "(not set)" ? "" : cwd,
      baseBranch,
      channelSystemMessage: systemMessage === "(none)" ? "" : systemMessage,
    };

    return {
      config: { wide_screen_mode: true },
      header: {
        template: "turquoise",
        title: { tag: "plain_text", content: "Channel setting" },
      },
      elements: [
        ...(notice
          ? [
            {
              tag: "markdown",
              content: `✅ ${notice}`,
            },
          ]
          : []),
        {
          tag: "markdown",
          content: [
            `- Channel: \`${channelId}\``,
            `- Provider: \`${provider}\``,
            `- Model: \`${model}\``,
            `- Working directory: \`${cwd}\``,
            `- Base branch: \`${baseBranch}\``,
            `- Channel system message: ${systemMessage}`,
          ].join("\n"),
        },
        {
          tag: "markdown",
          content: "Provider",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "select_static",
              placeholder: { tag: "plain_text", content: "Select provider" },
              options: providerOptions,
              value: {
                ...settingsBaseValue,
                field: "provider",
              },
            },
          ],
        },
        {
          tag: "markdown",
          content: "Model",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "select_static",
              placeholder: { tag: "plain_text", content: "Select model" },
              options: modelOptions.length > 0
                ? modelOptions
                : [{ text: { tag: "plain_text", content: "(empty)" }, value: "" }],
              value: {
                ...settingsBaseValue,
                field: "model",
              },
            },
          ],
        },
        {
          tag: "markdown",
          content: "Working directory",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "select_static",
              placeholder: { tag: "plain_text", content: "Select working directory" },
              options: workingDirectoryOptions,
              value: {
                ...settingsBaseValue,
                field: "workingDirectory",
              },
            },
          ],
        },
        {
          tag: "markdown",
          content: "Base branch",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "select_static",
              placeholder: { tag: "plain_text", content: "Select base branch" },
              options: baseBranchOptions,
              value: {
                ...settingsBaseValue,
                field: "baseBranch",
              },
            },
          ],
        },
        {
          tag: "markdown",
          content: "Channel system message",
        },
        {
          tag: "action",
          actions: [
            {
              tag: "select_static",
              placeholder: { tag: "plain_text", content: "Select system message" },
              options: channelSystemMessageOptions,
              value: {
                ...settingsBaseValue,
                field: "channelSystemMessage",
              },
            },
          ],
        },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              type: "primary",
              text: { tag: "plain_text", content: "Refresh" },
              value: {
                ...settingsBaseValue,
                field: "refresh",
              },
            },
            {
              tag: "button",
              type: "default",
              text: { tag: "plain_text", content: "Open channel page" },
              url: workspaceUrl,
            },
            {
              tag: "button",
              type: "primary",
              text: { tag: "plain_text", content: "Back" },
              value: { action: "open_settings_launcher", channelId, threadId },
            },
          ],
        },
      ],
    };
  }

  const github = getGitHubInfoForUser(userId);
  const githubToken = github?.token || "";
  const githubName = github?.gitName || "";
  const githubEmail = github?.gitEmail || "";
  const githubBaseValue = {
    action: "set_github_info",
    channelId,
    threadId,
    githubToken,
    githubName,
    githubEmail,
  };
  return {
    config: { wide_screen_mode: true },
    header: {
      template: "violet",
      title: { tag: "plain_text", content: "GitHub info" },
    },
    elements: [
      ...(notice
        ? [
          {
            tag: "markdown",
            content: `✅ ${notice}`,
          },
        ]
        : []),
      {
        tag: "markdown",
        content: [
          `- User: \`${userId}\``,
          `- Token: \`${maskedToken(github?.token)}\``,
          `- Git name: \`${github?.gitName || "(not set)"}\``,
          `- Git email: \`${github?.gitEmail || "(not set)"}\``,
        ].join("\n"),
      },
      {
        tag: "markdown",
        content: "GitHub token",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "select_static",
            placeholder: { tag: "plain_text", content: "Token action" },
            options: [
              { text: { tag: "plain_text", content: "Keep current" }, value: githubToken },
              { text: { tag: "plain_text", content: "Clear token" }, value: "" },
            ],
            value: {
              ...githubBaseValue,
              field: "githubToken",
            },
          },
        ],
      },
      {
        tag: "markdown",
        content: "Git name",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "select_static",
            placeholder: { tag: "plain_text", content: "Select git name" },
            options: [
              { text: { tag: "plain_text", content: githubName || "(not set)" }, value: githubName },
              { text: { tag: "plain_text", content: "LIU9293" }, value: "LIU9293" },
              { text: { tag: "plain_text", content: "(empty)" }, value: "" },
            ],
            value: {
              ...githubBaseValue,
              field: "githubName",
            },
          },
        ],
      },
      {
        tag: "markdown",
        content: "Git email",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "select_static",
            placeholder: { tag: "plain_text", content: "Select git email" },
            options: [
              { text: { tag: "plain_text", content: githubEmail || "(not set)" }, value: githubEmail },
              { text: { tag: "plain_text", content: "mylock.kai@gmail.com" }, value: "mylock.kai@gmail.com" },
              { text: { tag: "plain_text", content: "(empty)" }, value: "" },
            ],
            value: {
              ...githubBaseValue,
              field: "githubEmail",
            },
          },
        ],
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            type: "primary",
            text: { tag: "plain_text", content: "Refresh" },
            value: {
              ...githubBaseValue,
              field: "refresh",
            },
          },
          {
            tag: "button",
            type: "danger",
            text: { tag: "plain_text", content: "Clear" },
            value: {
              action: "clear_github_info",
              channelId,
              threadId,
            },
          },
          {
            tag: "button",
            type: "default",
            text: { tag: "plain_text", content: "Open workspace page" },
            url: workspaceUrl,
          },
          {
            tag: "button",
            type: "primary",
            text: { tag: "plain_text", content: "Back" },
            value: { action: "open_settings_launcher", channelId, threadId },
          },
        ],
      },
    ],
  };
}

export async function sendLarkSettingsCard(params: {
  channelId: string;
  threadId: string;
  sendInteractive: (card: Record<string, unknown>) => Promise<string | undefined>;
  sendText: (text: string) => Promise<string | undefined>;
  logEvent: (message: string, payload: Record<string, unknown>) => void;
}): Promise<string | undefined> {
  const { channelId, threadId, sendInteractive, sendText, logEvent } = params;
  const settingsUrl = getLocalSettingsUrl();
  logEvent("Lark settings UI launcher triggered", {
    channelId,
    threadId,
    settingsUrl,
  });

  const card = buildSettingsLauncherCard(channelId, threadId);

  try {
    const messageId = await sendInteractive(card as unknown as Record<string, unknown>);
    logEvent("Lark settings card sent", {
      channelId,
      threadId,
      messageId: messageId ?? "",
    });
    return messageId;
  } catch {
    logEvent("Lark settings card failed, sending fallback text", {
      channelId,
      threadId,
    });
    const fallbackText = [
      "Ode settings",
      `Open: ${settingsUrl}`,
      `Channel: ${channelId}`,
      "Use this channel in Local Setting to configure provider/model/directory.",
    ].join("\n");
    return sendText(fallbackText);
  }
}
