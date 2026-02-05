import { getApp } from "./client";
import {
  getChannelDevServerId,
  getChannelModel,
  resolveChannelCwd,
  getDevServers,
  getGitHubInfoForUser,
  isLocalMode,
  setChannelDevServerId,
  setChannelModel,
  setChannelWorkingDirectory,
  setGitHubInfoForUser,
} from "@ode/config";

const SETTINGS_LAUNCH_ACTION = "open_settings_modal";
const SETTINGS_MODAL_ID = "settings_modal";
const GITHUB_LAUNCH_ACTION = "open_github_token_modal";
const GITHUB_MODAL_ID = "github_token_modal";
const GITHUB_TOKEN_BLOCK = "github_token";
const GITHUB_TOKEN_ACTION = "github_token_input";
const GITHUB_NAME_BLOCK = "github_name";
const GITHUB_NAME_ACTION = "github_name_input";
const GITHUB_EMAIL_BLOCK = "github_email";
const GITHUB_EMAIL_ACTION = "github_email_input";
const DEV_SERVER_BLOCK = "dev_server";
const DEV_SERVER_ACTION = "dev_server_select";
const MODEL_BLOCK = "model";
const MODEL_ACTION = "model_select";
const WORKING_DIR_BLOCK = "working_dir";
const WORKING_DIR_ACTION = "working_dir_input";

function buildSettingsModal(params: {
  channelId: string;
  devServers: Array<{ id: string; name: string; models: string[] }>;
  selectedDevServerId?: string | null;
  selectedModel?: string | null;
  workingDirectory?: string | null;
}) {
  const { channelId, devServers, selectedDevServerId, selectedModel, workingDirectory } = params;
  const selectedServer = devServers.find((server) => server.id === selectedDevServerId)
    ?? devServers[0];

  const serverOptions = devServers.map((server) => ({
    text: { type: "plain_text" as const, text: server.name },
    value: server.id,
  }));

  const models = selectedServer?.models ?? [];
  const modelOptions = models.length > 0
    ? models.map((model) => ({
        text: { type: "plain_text" as const, text: model },
        value: model,
      }))
    : [{ text: { type: "plain_text" as const, text: "No models configured" }, value: "__none__" }];

  const initialModel = selectedModel && models.includes(selectedModel)
    ? selectedModel
    : (models[0] ?? "__none__");

  return {
    type: "modal" as const,
    callback_id: SETTINGS_MODAL_ID,
    private_metadata: channelId,
    title: { type: "plain_text" as const, text: "Channel Settings" },
    submit: { type: "plain_text" as const, text: "Save" },
    close: { type: "plain_text" as const, text: "Cancel" },
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: "Configure the dev server, model, and working directory for this channel.",
        },
      },
      {
        type: "input" as const,
        block_id: DEV_SERVER_BLOCK,
        label: { type: "plain_text" as const, text: "Dev Server" },
        element: {
          type: "static_select" as const,
          action_id: DEV_SERVER_ACTION,
          options: serverOptions,
          initial_option: selectedServer
            ? { text: { type: "plain_text" as const, text: selectedServer.name }, value: selectedServer.id }
            : undefined,
        },
      },
      {
        type: "input" as const,
        block_id: MODEL_BLOCK,
        label: { type: "plain_text" as const, text: "Model" },
        element: {
          type: "static_select" as const,
          action_id: MODEL_ACTION,
          options: modelOptions,
          initial_option: initialModel
            ? { text: { type: "plain_text" as const, text: initialModel }, value: initialModel }
            : undefined,
        },
      },
      {
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
      },
    ],
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
    ? "A GitHub token is already set for your account. Submit a new value to update it."
    : "Set a GitHub token to enable GitHub CLI actions and git identity.";

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

export function setupInteractiveHandlers(): void {
  const slackApp = getApp();

  slackApp.action(SETTINGS_LAUNCH_ACTION, async ({ ack, body, client }) => {
    await ack();

    const channelId = (body as any).actions?.[0]?.value
      ?? (body as any).channel?.id;
    const userId = (body as any).user?.id;
    if (!channelId) return;

    if (!isLocalMode()) {
      if (channelId && userId) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: "Settings updates are not implemented in cloud mode.",
        });
      }
      return;
    }

    const devServers = getDevServers();
    if (devServers.length === 0) {
      if (channelId && userId) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: "No dev servers configured in ~/.config/ode/ode.json.",
        });
      }
      return;
    }

    const view = buildSettingsModal({
      channelId,
      devServers,
      selectedDevServerId: getChannelDevServerId(channelId),
      selectedModel: getChannelModel(channelId),
      workingDirectory: resolveChannelCwd(channelId).workingDirectory,
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

    if (!isLocalMode()) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: "GitHub info updates are not implemented in cloud mode.",
      });
      return;
    }

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

  slackApp.action(DEV_SERVER_ACTION, async ({ ack, body, client }) => {
    await ack();

    const view = (body as any).view;
    if (!view) return;

    const channelId = view.private_metadata;
    const selectedDevServerId = (body as any).actions?.[0]?.selected_option?.value;
    const workingDirectory = view.state?.values?.[WORKING_DIR_BLOCK]?.[WORKING_DIR_ACTION]?.value || "";
    const selectedModel = view.state?.values?.[MODEL_BLOCK]?.[MODEL_ACTION]?.selected_option?.value || "";

    const devServers = getDevServers();
    if (devServers.length === 0) return;

    const updatedView = buildSettingsModal({
      channelId,
      devServers,
      selectedDevServerId,
      selectedModel,
      workingDirectory,
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
    const selectedDevServerId = values?.[DEV_SERVER_BLOCK]?.[DEV_SERVER_ACTION]?.selected_option?.value;
    const selectedModel = values?.[MODEL_BLOCK]?.[MODEL_ACTION]?.selected_option?.value;
    const workingDirectory = values?.[WORKING_DIR_BLOCK]?.[WORKING_DIR_ACTION]?.value || "";

    const errors: Record<string, string> = {};

    if (!selectedDevServerId) {
      errors[DEV_SERVER_BLOCK] = "Select a dev server.";
    }
    if (!selectedModel || selectedModel === "__none__") {
      errors[MODEL_BLOCK] = "Select a model.";
    }

    const devServers = getDevServers();
    const devServer = devServers.find((server) => server.id === selectedDevServerId);
    if (!devServer) {
      errors[DEV_SERVER_BLOCK] = "Dev server not found in ~/.config/ode/ode.json.";
    } else if (selectedModel && !devServer.models.includes(selectedModel)) {
      errors[MODEL_BLOCK] = "Model not available on the selected dev server.";
    }

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: "errors", errors });
      return;
    }

    await ack();

    try {
      if (selectedDevServerId) {
        setChannelDevServerId(channelId, selectedDevServerId);
      }
      if (selectedModel) {
        setChannelModel(channelId, selectedModel);
      }

      const workingDirValue = workingDirectory.trim();
      setChannelWorkingDirectory(channelId, workingDirValue.length > 0 ? workingDirValue : null);
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
    const errors: Record<string, string> = {};

    if (!trimmed) {
      errors[GITHUB_TOKEN_BLOCK] = "Enter a GitHub token.";
    }

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: "errors", errors });
      return;
    }

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
      await handleButtonSelection(channel, threadTs, userId || "unknown", value, selectionMsg.ts, client);
    }
  });
}
