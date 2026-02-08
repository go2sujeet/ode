import { getApps } from "./client";
import {
  getChannelAgentProvider,
  getChannelModel,
  resolveChannelCwd,
  getWorkspaces,
  getEnabledAgentProviders,
  getOpenCodeModels,
  getCodexModels,
  isAgentEnabled,
  getGitHubInfoForUser,
  setChannelAgentProvider,
  setChannelModel,
  setChannelWorkingDirectory,
  getChannelBaseBranch,
  setChannelBaseBranch,
  getChannelSystemMessage,
  setChannelSystemMessage,
  setGitHubInfoForUser,
  getUserGeneralSettings,
  setUserGeneralSettings,
  invalidateOdeConfigCache,
} from "@/config";
import { startServer as startOpenCodeServer } from "@/agents/opencode";
import { startServer as startCodexServer } from "@/agents/codex";
import { syncSlackWorkspace } from "@/core/web/local-settings";

const SETTINGS_LAUNCH_ACTION = "open_settings_modal";
const SETTINGS_MODAL_ID = "settings_modal";
const GENERAL_SETTINGS_LAUNCH_ACTION = "open_general_settings_modal";
const GENERAL_SETTINGS_MODAL_ID = "general_settings_modal";
const GENERAL_SYNC_WORKSPACE_ACTION = "general_sync_workspace";
const GITHUB_LAUNCH_ACTION = "open_github_token_modal";
const GITHUB_MODAL_ID = "github_token_modal";
const GITHUB_TOKEN_BLOCK = "github_token";
const GITHUB_TOKEN_ACTION = "github_token_input";
const GITHUB_NAME_BLOCK = "github_name";
const GITHUB_NAME_ACTION = "github_name_input";
const GITHUB_EMAIL_BLOCK = "github_email";
const GITHUB_EMAIL_ACTION = "github_email_input";
const PROVIDER_BLOCK = "provider";
const PROVIDER_ACTION = "provider_select";
const MODEL_BLOCK = "model";
const MODEL_ACTION = "model_select";
const WORKING_DIR_BLOCK = "working_dir";
const WORKING_DIR_ACTION = "working_dir_input";
const BASE_BRANCH_BLOCK = "base_branch";
const BASE_BRANCH_ACTION = "base_branch_input";
const CHANNEL_SYSTEM_MESSAGE_BLOCK = "channel_system_message";
const CHANNEL_SYSTEM_MESSAGE_ACTION = "channel_system_message_input";
const GENERAL_STATUS_MESSAGE_FORMAT_BLOCK = "general_status_message_format";
const GENERAL_STATUS_MESSAGE_FORMAT_ACTION = "general_status_message_format_select";
const GENERAL_GIT_STRATEGY_BLOCK = "general_git_strategy";
const GENERAL_GIT_STRATEGY_ACTION = "general_git_strategy_select";

type AgentProvider = "opencode" | "claudecode" | "codex" | "kimi" | "kiro" | "qwen";
type StatusMessageFormat = "aggressive" | "medium" | "minimum";
type GitStrategy = "default" | "worktree";

const AGENT_PROVIDERS: AgentProvider[] = ["opencode", "claudecode", "codex", "kimi", "kiro", "qwen"];

const AGENT_PROVIDER_LABELS: Record<AgentProvider, string> = {
  opencode: "OpenCode",
  claudecode: "Claude Code",
  codex: "Codex",
  kimi: "Kimi",
  kiro: "Kiro",
  qwen: "Qwen Code",
};

const STATUS_MESSAGE_FORMAT_OPTIONS: Array<{ label: string; value: StatusMessageFormat }> = [
  { label: "Aggressive", value: "aggressive" },
  { label: "Medium", value: "medium" },
  { label: "Minimum", value: "minimum" },
];

const GIT_STRATEGY_OPTIONS: Array<{ label: string; value: GitStrategy }> = [
  { label: "Worktree", value: "worktree" },
  { label: "Default", value: "default" },
];

function parseAgentProvider(value: unknown): AgentProvider {
  if (typeof value !== "string") return "opencode";
  return AGENT_PROVIDERS.includes(value as AgentProvider) ? value as AgentProvider : "opencode";
}

function normalizeModel(value: string): string {
  return value.trim().toLowerCase();
}

function findMatchingModel(models: string[], value: string | null | undefined): string | null {
  if (!value) return null;
  const target = normalizeModel(value);
  return models.find((model) => normalizeModel(model) === target) ?? null;
}

function getSelectableProviders(): AgentProvider[] {
  const enabled = getEnabledAgentProviders().filter(
    (provider): provider is AgentProvider => AGENT_PROVIDERS.includes(provider as AgentProvider)
  );
  if (enabled.length > 0) return enabled;
  return AGENT_PROVIDERS;
}

function toSelectableProvider(provider: "opencode" | "claudecode" | "codex" | "kimi" | "kiro" | "qwen"): AgentProvider {
  return parseAgentProvider(provider);
}

function buildSettingsModal(params: {
  channelId: string;
  enabledProviders: AgentProvider[];
  opencodeModels: string[];
  codexModels: string[];
  selectedProvider?: AgentProvider;
  selectedModel?: string | null;
  workingDirectory?: string | null;
  baseBranch?: string | null;
  channelSystemMessage?: string | null;
}) {
  const {
    channelId,
    enabledProviders,
    opencodeModels,
    codexModels,
    selectedProvider = "opencode",
    selectedModel,
    workingDirectory,
    baseBranch,
    channelSystemMessage,
  } = params;
  const providerOptions = enabledProviders.map((provider) => ({
    text: { type: "plain_text" as const, text: AGENT_PROVIDER_LABELS[provider] },
    value: provider,
  }));
  const providerModels = selectedProvider === "opencode"
    ? opencodeModels
    : selectedProvider === "codex"
      ? codexModels
      : null;
  const modelOptions = providerModels && selectedProvider === "opencode"
    ? (opencodeModels.length > 0
      ? opencodeModels.map((model) => ({
          text: { type: "plain_text" as const, text: model },
          value: model,
        }))
      : [{ text: { type: "plain_text" as const, text: "No models configured" }, value: "__none__" }])
    : providerModels && selectedProvider === "codex"
      ? [
          { text: { type: "plain_text" as const, text: "Use default (gpt-5.3-codex)" }, value: "__default__" },
          ...codexModels.map((model) => ({
            text: { type: "plain_text" as const, text: model },
            value: model,
          })),
        ]
      : [];

  const availableModels = selectedProvider === "codex"
    ? modelOptions.map((entry) => entry.value)
    : providerModels ?? [];
  const matchedSelectedModel = findMatchingModel(availableModels, selectedModel);
  const initialModel = matchedSelectedModel
    ? matchedSelectedModel
    : (selectedProvider === "codex" ? "__default__" : (opencodeModels[0] ?? "__none__"));
  const introText = selectedProvider === "opencode"
    ? "Configure agent, model (OpenCode), working directory, and base branch for this channel."
    : selectedProvider === "codex"
      ? "Configure agent, optional Codex model, working directory, and base branch for this channel."
      : "Configure agent, working directory, and base branch for this channel.";

  const blocks: any[] = [
    {
      type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: introText,
        },
      },
    {
      type: "input" as const,
      block_id: PROVIDER_BLOCK,
      dispatch_action: true,
      label: { type: "plain_text" as const, text: "Provider" },
      element: {
        type: "static_select" as const,
        action_id: PROVIDER_ACTION,
        options: providerOptions,
        initial_option: providerOptions.find((option) => option.value === selectedProvider) ?? providerOptions[0],
      },
    },
  ];

  if (providerModels) {
    const initialOption = modelOptions.find((option) => option.value === initialModel);
    blocks.push(
      {
        type: "input" as const,
        block_id: MODEL_BLOCK,
        optional: selectedProvider === "codex",
        label: { type: "plain_text" as const, text: "Model" },
        element: {
          type: "static_select" as const,
          action_id: MODEL_ACTION,
          options: modelOptions,
          initial_option: initialOption,
        },
      },
    );
  }

  blocks.push({
    type: "input" as const,
    block_id: WORKING_DIR_BLOCK,
    optional: true,
    label: { type: "plain_text" as const, text: "Working Directory" },
    element: {
      type: "plain_text_input" as const,
      action_id: WORKING_DIR_ACTION,
      initial_value: workingDirectory ?? "",
      placeholder: { type: "plain_text" as const, text: "e.g., ~/Code/ode" },
    },
  });

  blocks.push({
    type: "input" as const,
    block_id: BASE_BRANCH_BLOCK,
    optional: true,
    label: { type: "plain_text" as const, text: "Base Branch" },
    element: {
      type: "plain_text_input" as const,
      action_id: BASE_BRANCH_ACTION,
      initial_value: baseBranch?.trim() || "main",
      placeholder: { type: "plain_text" as const, text: "e.g., main" },
    },
  });

  blocks.push({
    type: "input" as const,
    block_id: CHANNEL_SYSTEM_MESSAGE_BLOCK,
    optional: true,
    label: { type: "plain_text" as const, text: "Channel System Message (optional)" },
    element: {
      type: "plain_text_input" as const,
      action_id: CHANNEL_SYSTEM_MESSAGE_ACTION,
      multiline: true,
      initial_value: channelSystemMessage ?? "",
      placeholder: { type: "plain_text" as const, text: "Instructions appended to the system prompt for this channel" },
    },
  });

  return {
    type: "modal" as const,
    callback_id: SETTINGS_MODAL_ID,
    private_metadata: channelId,
    title: { type: "plain_text" as const, text: "Channel Settings" },
    submit: { type: "plain_text" as const, text: "Save" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks,
  };
}

function buildGitHubTokenModal(params: {
  channelId: string;
  hasToken: boolean;
  token?: string;
  gitName?: string;
  gitEmail?: string;
}) {
  const { channelId, hasToken, token, gitName, gitEmail } = params;
  const statusText = hasToken
    ? "A GitHub token is already set for your account. Update it if needed; git name/email are used for commits."
    : "GitHub token is optional and only needed for GitHub CLI actions. Git name/email are used for commits.";

  return {
    type: "modal" as const,
    callback_id: GITHUB_MODAL_ID,
    private_metadata: channelId,
    title: { type: "plain_text" as const, text: "GitHub Token" },
    submit: { type: "plain_text" as const, text: "Save" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: statusText },
      },
      {
        type: "input" as const,
        block_id: GITHUB_TOKEN_BLOCK,
        label: { type: "plain_text" as const, text: "GitHub Token" },
        optional: true,
        element: {
          type: "plain_text_input" as const,
          action_id: GITHUB_TOKEN_ACTION,
          initial_value: token ?? "",
          placeholder: { type: "plain_text" as const, text: "ghp_..." },
        },
      },
      {
        type: "input" as const,
        block_id: GITHUB_NAME_BLOCK,
        label: { type: "plain_text" as const, text: "Git Name" },
        element: {
          type: "plain_text_input" as const,
          action_id: GITHUB_NAME_ACTION,
          initial_value: gitName ?? "",
          placeholder: { type: "plain_text" as const, text: "Jane Doe" },
        },
      },
      {
        type: "input" as const,
        block_id: GITHUB_EMAIL_BLOCK,
        label: { type: "plain_text" as const, text: "Git Email" },
        element: {
          type: "plain_text_input" as const,
          action_id: GITHUB_EMAIL_ACTION,
          initial_value: gitEmail ?? "",
          placeholder: { type: "plain_text" as const, text: "jane@example.com" },
        },
      },
    ],
  };
}

function buildGeneralSettingsModal(params: {
  channelId: string;
  statusMessageFormat: StatusMessageFormat;
  gitStrategy: GitStrategy;
}) {
  const { channelId, statusMessageFormat, gitStrategy } = params;
  const statusMessageFormatOptions = STATUS_MESSAGE_FORMAT_OPTIONS.map((option) => ({
    text: { type: "plain_text" as const, text: option.label },
    value: option.value,
  }));
  const gitStrategyOptions = GIT_STRATEGY_OPTIONS.map((option) => ({
    text: { type: "plain_text" as const, text: option.label },
    value: option.value,
  }));

  return {
    type: "modal" as const,
    callback_id: GENERAL_SETTINGS_MODAL_ID,
    private_metadata: channelId,
    title: { type: "plain_text" as const, text: "General Settings" },
    submit: { type: "plain_text" as const, text: "Save" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: "Configure default status message format and git strategy.",
        },
      },
      {
        type: "input" as const,
        block_id: GENERAL_STATUS_MESSAGE_FORMAT_BLOCK,
        label: { type: "plain_text" as const, text: "Status Message Format" },
        element: {
          type: "static_select" as const,
          action_id: GENERAL_STATUS_MESSAGE_FORMAT_ACTION,
          options: statusMessageFormatOptions,
          initial_option:
            statusMessageFormatOptions.find((option) => option.value === statusMessageFormat)
            ?? statusMessageFormatOptions[1],
        },
      },
      {
        type: "input" as const,
        block_id: GENERAL_GIT_STRATEGY_BLOCK,
        label: { type: "plain_text" as const, text: "Git Strategy" },
        element: {
          type: "static_select" as const,
          action_id: GENERAL_GIT_STRATEGY_ACTION,
          options: gitStrategyOptions,
          initial_option:
            gitStrategyOptions.find((option) => option.value === gitStrategy)
            ?? gitStrategyOptions[0],
        },
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            action_id: GENERAL_SYNC_WORKSPACE_ACTION,
            text: { type: "plain_text" as const, text: "Sync Workspace" },
            style: "primary" as const,
            value: channelId,
          },
        ],
      },
    ],
  };
}

export function setupInteractiveHandlers(): void {
  for (const slackApp of getApps()) {
    slackApp.action(SETTINGS_LAUNCH_ACTION, async ({ ack, body, client }) => {
    await ack();

    const channelId = (body as any).actions?.[0]?.value
      ?? (body as any).channel?.id;
    if (!channelId) return;

    try {
      await startOpenCodeServer();
    } catch {
      // Fall back to models currently stored in local config.
    }
    try {
      await startCodexServer();
    } catch {
      // Fall back to models currently stored in local config.
    }

    const enabledProviders = getSelectableProviders();

    const view = buildSettingsModal({
      channelId,
      enabledProviders,
      opencodeModels: getOpenCodeModels(),
      codexModels: getCodexModels(),
      selectedProvider: toSelectableProvider(getChannelAgentProvider(channelId)),
      selectedModel: getChannelModel(channelId),
      workingDirectory: resolveChannelCwd(channelId).workingDirectory,
      baseBranch: getChannelBaseBranch(channelId),
      channelSystemMessage: getChannelSystemMessage(channelId),
    });

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view,
    });
    });

    slackApp.action(GITHUB_LAUNCH_ACTION, async ({ ack, body, client }) => {
    await ack();

    const channelId = (body as any).actions?.[0]?.value
      ?? (body as any).channel?.id;
    const userId = (body as any).user?.id;
    if (!channelId || !userId) return;

    const info = getGitHubInfoForUser(userId);
    const view = buildGitHubTokenModal({
      channelId,
      hasToken: Boolean(info?.token),
      token: info?.token,
      gitName: info?.gitName,
      gitEmail: info?.gitEmail,
    });

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view,
    });
    });

    slackApp.action(GENERAL_SETTINGS_LAUNCH_ACTION, async ({ ack, body, client }) => {
    await ack();

    const channelId = (body as any).actions?.[0]?.value
      ?? (body as any).channel?.id
      ?? "";
    const generalSettings = getUserGeneralSettings();
    const view = buildGeneralSettingsModal({
      channelId,
      statusMessageFormat: generalSettings.defaultStatusMessageFormat,
      gitStrategy: generalSettings.gitStrategy,
    });

    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view,
    });
    });

    slackApp.action(GENERAL_SYNC_WORKSPACE_ACTION, async ({ ack, body, client }) => {
      await ack();

      const channelId = (body as any).actions?.[0]?.value
        ?? (body as any).view?.private_metadata
        ?? (body as any).channel?.id;
      const userId = (body as any).user?.id;
      if (!channelId || !userId) return;

      const workspaces = getWorkspaces();
      const syncResults = await Promise.allSettled(
        workspaces.map(async (workspace) => syncSlackWorkspace(workspace.id))
      );

      const successful = syncResults
        .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof syncSlackWorkspace>>> => result.status === "fulfilled")
        .map((result) => result.value);
      const syncedWorkspaces = successful.length;
      const syncedChannels = successful.reduce((sum, workspace) => sum + (workspace.channels ?? workspace.channelDetails.length), 0);
      const failedWorkspaces = syncResults.length - syncedWorkspaces;

      invalidateOdeConfigCache();

      const message = failedWorkspaces > 0
        ? `Synced ${syncedWorkspaces} workspaces with ${syncedChannels} channels in total. Failed to sync ${failedWorkspaces} workspaces.`
        : `Synced ${syncedWorkspaces} workspaces with ${syncedChannels} channels in total.`;

      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: message,
      });
    });

    slackApp.action(PROVIDER_ACTION, async ({ ack, body, client }) => {
    await ack();

    const view = (body as any).view;
    if (!view) return;

    const channelId = view.private_metadata;
    const selectedOption = (body as any).actions?.[0]?.selected_option?.value;
    const selectedProvider = parseAgentProvider(selectedOption);
    if (selectedProvider === "opencode") {
      try {
        await startOpenCodeServer();
      } catch {
        // Fall back to models currently stored in local config.
      }
    } else if (selectedProvider === "codex") {
      try {
        await startCodexServer();
      } catch {
        // Fall back to models currently stored in local config.
      }
    }
    const selectedModel = view.state?.values?.[MODEL_BLOCK]?.[MODEL_ACTION]?.selected_option?.value
      || getChannelModel(channelId)
      || undefined;
    const workingDirectory = view.state?.values?.[WORKING_DIR_BLOCK]?.[WORKING_DIR_ACTION]?.value || "";
    const baseBranch = view.state?.values?.[BASE_BRANCH_BLOCK]?.[BASE_BRANCH_ACTION]?.value
      || getChannelBaseBranch(channelId)
      || "main";
    const channelSystemMessage = view.state?.values?.[CHANNEL_SYSTEM_MESSAGE_BLOCK]?.[CHANNEL_SYSTEM_MESSAGE_ACTION]?.value
      || getChannelSystemMessage(channelId)
      || "";

    const updatedView = buildSettingsModal({
      channelId,
      enabledProviders: getSelectableProviders(),
      opencodeModels: getOpenCodeModels(),
      codexModels: getCodexModels(),
      selectedProvider,
      selectedModel,
      workingDirectory,
      baseBranch,
      channelSystemMessage,
    });

    await client.views.update({
      view_id: view.id,
      hash: view.hash,
      view: updatedView,
    });
    });

    slackApp.view(SETTINGS_MODAL_ID, async ({ ack, view, body, client }) => {
    const channelId = view.private_metadata;
    const values = view.state.values;
    const selectedProvider = parseAgentProvider(
      values?.[PROVIDER_BLOCK]?.[PROVIDER_ACTION]?.selected_option?.value
    );
    const selectedModel = values?.[MODEL_BLOCK]?.[MODEL_ACTION]?.selected_option?.value;
    const workingDirectory = values?.[WORKING_DIR_BLOCK]?.[WORKING_DIR_ACTION]?.value || "";
    const baseBranch = values?.[BASE_BRANCH_BLOCK]?.[BASE_BRANCH_ACTION]?.value || "main";
    const channelSystemMessage = values?.[CHANNEL_SYSTEM_MESSAGE_BLOCK]?.[CHANNEL_SYSTEM_MESSAGE_ACTION]?.value || "";

    const errors: Record<string, string> = {};
    if (!isAgentEnabled(selectedProvider)) {
      errors[PROVIDER_BLOCK] = "Selected agent is disabled.";
    }

    if (selectedProvider === "opencode") {
      if (!selectedModel || selectedModel === "__none__") {
        errors[MODEL_BLOCK] = "Select a model.";
      }

      const models = getOpenCodeModels();
      if (selectedModel && !findMatchingModel(models, selectedModel)) {
        errors[MODEL_BLOCK] = "Model not available in ~/.config/ode/ode.json agents.opencode.models.";
      }
    } else if (selectedProvider === "codex") {
      const models = getCodexModels();
      if (selectedModel && selectedModel !== "__default__" && !findMatchingModel(models, selectedModel)) {
        errors[MODEL_BLOCK] = "Model not available in local Codex model list.";
      }
    }

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: "errors", errors });
      return;
    }

    await ack();

    try {
      setChannelAgentProvider(channelId, selectedProvider);
      if (selectedProvider === "opencode" && selectedModel && selectedModel !== "__none__") {
        const normalizedSelectedModel = findMatchingModel(getOpenCodeModels(), selectedModel) ?? selectedModel;
        setChannelModel(channelId, normalizedSelectedModel);
      }
      if (selectedProvider === "codex") {
        if (selectedModel && selectedModel !== "__default__") {
          const normalizedSelectedModel = findMatchingModel(getCodexModels(), selectedModel) ?? selectedModel;
          setChannelModel(channelId, normalizedSelectedModel);
        } else {
          setChannelModel(channelId, "");
        }
      }
      if (selectedProvider === "claudecode" || selectedProvider === "kimi" || selectedProvider === "kiro" || selectedProvider === "qwen") {
        setChannelModel(channelId, "");
      }

      const workingDirValue = workingDirectory.trim();
      setChannelWorkingDirectory(channelId, workingDirValue.length > 0 ? workingDirValue : null);
      setChannelBaseBranch(channelId, baseBranch);
      setChannelSystemMessage(channelId, channelSystemMessage);
    } catch (err) {
      const userId = (body as any).user?.id;
      if (userId) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `Failed to update settings: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    const userId = (body as any).user?.id;
    if (userId) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "Channel settings updated.",
      });
    }
    });

    slackApp.view(GITHUB_MODAL_ID, async ({ ack, view, body, client }) => {
    const values = view.state.values;
    const token = values?.[GITHUB_TOKEN_BLOCK]?.[GITHUB_TOKEN_ACTION]?.value || "";
    const gitName = values?.[GITHUB_NAME_BLOCK]?.[GITHUB_NAME_ACTION]?.value || "";
    const gitEmail = values?.[GITHUB_EMAIL_BLOCK]?.[GITHUB_EMAIL_ACTION]?.value || "";
    const trimmed = token.trim();

    await ack();

    const userId = (body as any).user?.id;
    const channelId = (body as any).view?.private_metadata
      ?? (body as any).channel?.id;
    if (!userId || !channelId) return;

    try {
      setGitHubInfoForUser(userId, {
        token: trimmed,
        gitName,
        gitEmail,
      });
    } catch (err) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Failed to save GitHub info: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    await client.chat.postEphemeral({
      channel: channelId,
      user: userId,
      text: "GitHub info updated.",
    });
    });

    slackApp.view(GENERAL_SETTINGS_MODAL_ID, async ({ ack, view, body, client }) => {
    const values = view.state.values;
    const selectedStatusMessageFormat = values?.[GENERAL_STATUS_MESSAGE_FORMAT_BLOCK]?.[GENERAL_STATUS_MESSAGE_FORMAT_ACTION]?.selected_option?.value;
    const selectedGitStrategy = values?.[GENERAL_GIT_STRATEGY_BLOCK]?.[GENERAL_GIT_STRATEGY_ACTION]?.selected_option?.value;

    const statusMessageFormat: StatusMessageFormat =
      selectedStatusMessageFormat === "aggressive"
      || selectedStatusMessageFormat === "minimum"
      || selectedStatusMessageFormat === "medium"
        ? selectedStatusMessageFormat
        : "medium";
    const gitStrategy: GitStrategy = selectedGitStrategy === "default" ? "default" : "worktree";

    await ack();

    try {
      setUserGeneralSettings({
        defaultStatusMessageFormat: statusMessageFormat,
        gitStrategy,
      });
    } catch (err) {
      const userId = (body as any).user?.id;
      const channelId = view.private_metadata || (body as any).channel?.id;
      if (userId && channelId) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `Failed to update general settings: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    const userId = (body as any).user?.id;
    const channelId = view.private_metadata || (body as any).channel?.id;
    if (userId && channelId) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "General settings updated.",
      });
    }
    });

  // Handle user choice button clicks (from Ode ask_user actions)
    slackApp.action(/^user_choice_\d+$/, async ({ ack, body, client }) => {
    await ack();

    const action = (body as any).actions?.[0];
    const value = action?.value;
    const channel = (body as any).channel?.id;
    const threadTs = (body as any).message?.thread_ts || (body as any).message?.ts;
    const userId = (body as any).user?.id;
    const messageTs = (body as any).message?.ts;

    if (!value || !channel || !threadTs) return;

    // Update the original message to remove buttons (keep question text only)
    if (messageTs) {
      const originalText = (body as any).message?.text || "Question";
      await client.chat.update({
        channel,
        ts: messageTs,
        text: originalText,
        blocks: [],
      });
    }

    // Post the user's choice as a regular message in the thread (for visibility)
    const selectionMsg = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `${value}`,
    });

    // Send the selection to OpenCode so the model can respond
    const { handleButtonSelection } = await import("./client");
    if (selectionMsg.ts) {
      await handleButtonSelection(channel, threadTs, userId || "unknown", value, selectionMsg.ts);
    }
    });
  }
}
