import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  findMatchingModel,
  getProviderModelList,
  resolveStoredModelForProvider,
  type ProviderModelLists,
} from "@/shared/channel-settings";
import {
  AGENT_PROVIDERS,
  isAgentProviderId,
  type AgentProviderId,
} from "@/shared/agent-provider";
import {
  getChannelSystemMessage,
  getChannelAgentProvider,
  getChannelModel,
  getChannelBaseBranch,
  resolveChannelCwd,
  getOpenCodeModels,
  getCodexModels,
  getKiloModels,
  isAgentEnabled,
  setChannelAgentProvider,
  setChannelModel,
  setChannelWorkingDirectory,
  setChannelBaseBranch,
  setChannelSystemMessage,
  getGitHubInfoForUser,
  setGitHubInfoForUser,
  getUserGeneralSettings,
  setUserGeneralSettings,
  STATUS_MESSAGE_FREQUENCY_OPTIONS,
  parseStatusMessageFrequencyValue,
  parseStatusMessageFrequencyMs,
  toStatusMessageFrequencyValue,
  type StatusMessageFrequencyValue,
} from "@/config";
import { log } from "@/utils";

const DISCORD_MODAL_CHANNEL = "ode:modal:channel_details";
const DISCORD_MODAL_GITHUB = "ode:modal:github";
const STATUS_FORMAT_OPTIONS = ["aggressive", "medium", "minimum"] as const;
const STATUS_FREQUENCY_OPTIONS: StatusMessageFrequencyValue[] =
  STATUS_MESSAGE_FREQUENCY_OPTIONS.map((option) => option.value);
const GIT_STRATEGY_OPTIONS = ["worktree", "default"] as const;
const AUTO_UPDATE_OPTIONS = ["on", "off"] as const;
const PROVIDERS = AGENT_PROVIDERS;

const channelSettingsDrafts = new Map<string, { provider: AgentProviderId; model: string }>();
const generalSettingsDrafts = new Map<string, {
  statusFormat: typeof STATUS_FORMAT_OPTIONS[number];
  statusFrequencyMs: StatusMessageFrequencyValue;
  gitStrategy: typeof GIT_STRATEGY_OPTIONS[number];
  autoUpdate: typeof AUTO_UPDATE_OPTIONS[number];
}>();

type LauncherCommand = "setting";
type LauncherAction = "general" | "channel" | "github";

export const DISCORD_LAUNCHER_COMMANDS = [
  {
    name: "setting",
    description: "Open Ode settings",
  },
  {
    name: "settings",
    description: "Open Ode settings",
  },
] as const;

function getResolvedChannelId(target: any): string {
  const channel = target?.channel;
  if (channel?.isThread?.()) {
    return channel.parentId ?? target.channelId;
  }
  return target.channelId;
}

function buildSettingsChooserRows(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ode:launcher:general:${channelId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("General setting"),
      new ButtonBuilder()
        .setCustomId(`ode:launcher:channel:${channelId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Channel setting"),
      new ButtonBuilder()
        .setCustomId(`ode:launcher:github:${channelId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("GitHub info")
    ),
  ];
}

function buildLauncherReplyPayload(command: LauncherCommand, channelId: string): {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  return {
    content: command === "setting" ? "Choose what to configure in Discord:" : "Choose settings action:",
    components: buildSettingsChooserRows(channelId),
  };
}

export async function sendLauncherReplyForMessage(params: {
  message: any;
  command: LauncherCommand;
  channelId: string;
}): Promise<void> {
  const payload = buildLauncherReplyPayload(params.command, params.channelId);
  log.info("Discord settings launcher triggered from message", {
    channelId: params.channelId,
    threadId: params.message.channel?.id,
    command: params.command,
    userId: params.message.author.id,
  });
  await params.message.reply(payload);
}

function getModalValue(interaction: any, fieldId: string): string {
  return interaction.fields.getTextInputValue(fieldId) || "";
}

function parseProvider(value: string): AgentProviderId | null {
  const normalized = value.trim().toLowerCase();
  return isAgentProviderId(normalized) ? normalized : null;
}

function getProviderModels(provider: typeof PROVIDERS[number]): string[] {
  return getProviderModelList(provider, getProviderModelLists());
}

function getProviderModelLists(): ProviderModelLists {
  return {
    opencode: getOpenCodeModels(),
    codex: getCodexModels(),
    kilo: getKiloModels(),
  };
}

function draftKey(userId: string, channelId: string): string {
  return `${userId}:${channelId}`;
}

function getInitialChannelDraft(channelId: string): { provider: AgentProviderId; model: string } {
  const provider = getChannelAgentProvider(channelId);
  return {
    provider,
    model: getChannelModel(channelId) || "",
  };
}

function getDraftOrInitial(userId: string, channelId: string): { provider: AgentProviderId; model: string } {
  return channelSettingsDrafts.get(draftKey(userId, channelId)) ?? getInitialChannelDraft(channelId);
}

function buildChannelSettingsPickerPayload(params: {
  channelId: string;
  userId: string;
}): {
  content: string;
  components: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>>;
} {
  const { channelId, userId } = params;
  const draft = getDraftOrInitial(userId, channelId);
  const providerOptions = PROVIDERS.map((provider) => ({
    label: provider,
    value: provider,
    default: provider === draft.provider,
  }));

  const providerSelect = new StringSelectMenuBuilder()
    .setCustomId(`ode:channel:provider:${channelId}`)
    .setPlaceholder("Select provider")
    .addOptions(providerOptions);

  const components: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(providerSelect),
  ];

  const models = getProviderModels(draft.provider);
  if (models.length > 0) {
    const selectedModel = findMatchingModel(models, draft.model) ?? models[0]!;
    const modelOptions = models.slice(0, 25).map((model) => ({
      label: model.slice(0, 100),
      value: model,
      default: model === selectedModel,
    }));
    const modelSelect = new StringSelectMenuBuilder()
      .setCustomId(`ode:channel:model:${channelId}`)
      .setPlaceholder("Select model")
      .addOptions(modelOptions);
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(modelSelect));
  }

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ode:channel:edit:${channelId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Edit details"),
      new ButtonBuilder()
        .setCustomId(`ode:channel:save:${channelId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel("Save provider/model")
    )
  );

  return {
    content: `Channel settings (draft)\nProvider: ${draft.provider}\nModel: ${draft.model || "(none)"}\nWorking dir: ${resolveChannelCwd(channelId).workingDirectory || "(not set)"}`,
    components,
  };
}

function parseGeneralStatusFormat(value: string): "aggressive" | "medium" | "minimum" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "aggressive" || normalized === "medium" || normalized === "minimum") {
    return normalized;
  }
  return null;
}

function parseGitStrategy(value: string): "default" | "worktree" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "default" || normalized === "worktree") return normalized;
  return null;
}

function parseStatusFrequency(value: string): StatusMessageFrequencyValue | null {
  return parseStatusMessageFrequencyValue(value);
}

function parseAutoUpdate(value: string): "on" | "off" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "on" || normalized === "off") return normalized;
  return null;
}

function getInitialGeneralDraft(): {
  statusFormat: typeof STATUS_FORMAT_OPTIONS[number];
  statusFrequencyMs: StatusMessageFrequencyValue;
  gitStrategy: typeof GIT_STRATEGY_OPTIONS[number];
  autoUpdate: typeof AUTO_UPDATE_OPTIONS[number];
} {
  const settings = getUserGeneralSettings();
  return {
    statusFormat: settings.defaultStatusMessageFormat,
    statusFrequencyMs: toStatusMessageFrequencyValue(settings.statusMessageFrequencyMs),
    gitStrategy: settings.gitStrategy,
    autoUpdate: settings.autoUpdate ? "on" : "off",
  };
}

function getGeneralDraftOrInitial(userId: string, channelId: string): {
  statusFormat: typeof STATUS_FORMAT_OPTIONS[number];
  statusFrequencyMs: StatusMessageFrequencyValue;
  gitStrategy: typeof GIT_STRATEGY_OPTIONS[number];
  autoUpdate: typeof AUTO_UPDATE_OPTIONS[number];
} {
  return generalSettingsDrafts.get(draftKey(userId, channelId)) ?? getInitialGeneralDraft();
}

function buildGeneralSettingsPickerPayload(params: {
  channelId: string;
  userId: string;
}): {
  content: string;
  components: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>>;
} {
  const draft = getGeneralDraftOrInitial(params.userId, params.channelId);

  const statusSelect = new StringSelectMenuBuilder()
    .setCustomId(`ode:general:status:${params.channelId}`)
    .setPlaceholder("Status format")
    .addOptions(
      STATUS_FORMAT_OPTIONS.map((value) => ({
        label: value,
        value,
        default: value === draft.statusFormat,
      }))
    );

  const gitSelect = new StringSelectMenuBuilder()
    .setCustomId(`ode:general:git:${params.channelId}`)
    .setPlaceholder("Git strategy")
    .addOptions(
      GIT_STRATEGY_OPTIONS.map((value) => ({
        label: value,
        value,
        default: value === draft.gitStrategy,
      }))
    );

  const statusFrequencySelect = new StringSelectMenuBuilder()
    .setCustomId(`ode:general:frequency:${params.channelId}`)
    .setPlaceholder("Status frequency")
    .addOptions(
      STATUS_FREQUENCY_OPTIONS.map((value) => ({
        label: `${Number(value) / 1000} seconds`,
        value,
        default: value === draft.statusFrequencyMs,
      }))
    );

  const autoUpdateSelect = new StringSelectMenuBuilder()
    .setCustomId(`ode:general:auto_update:${params.channelId}`)
    .setPlaceholder("Auto update")
    .addOptions(
      AUTO_UPDATE_OPTIONS.map((value) => ({
        label: value === "on" ? "On" : "Off",
        value,
        default: value === draft.autoUpdate,
      }))
    );

  return {
    content: `General settings (draft)\nStatus: ${draft.statusFormat}\nStatus frequency: ${Number(draft.statusFrequencyMs) / 1000} seconds\nGit strategy: ${draft.gitStrategy}\nAuto update: ${draft.autoUpdate}`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(statusSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(statusFrequencySelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(gitSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(autoUpdateSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ode:general:save:${params.channelId}`)
          .setStyle(ButtonStyle.Primary)
          .setLabel("Save general settings")
      ),
    ],
  };
}

function textInputRow(params: {
  id: string;
  label: string;
  style?: TextInputStyle;
  required?: boolean;
  value?: string;
  placeholder?: string;
}): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder()
    .setCustomId(params.id)
    .setLabel(params.label)
    .setStyle(params.style ?? TextInputStyle.Short)
    .setRequired(params.required ?? false);

  if (params.value) input.setValue(params.value);
  if (params.placeholder) input.setPlaceholder(params.placeholder);

  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function buildChannelSettingsModal(channelId: string): ModalBuilder {
  const baseBranch = getChannelBaseBranch(channelId) || "main";
  const workingDirectory = resolveChannelCwd(channelId).workingDirectory || "";
  const systemMessage = getChannelSystemMessage(channelId) || "";

  return new ModalBuilder()
    .setCustomId(`${DISCORD_MODAL_CHANNEL}:${channelId}`)
    .setTitle("Channel Settings")
    .addComponents(
      textInputRow({
        id: "working_directory",
        label: "Working directory",
        required: false,
        value: workingDirectory,
      }),
      textInputRow({
        id: "base_branch",
        label: "Base branch",
        required: true,
        value: baseBranch,
      }),
      textInputRow({
        id: "channel_system_message",
        label: "Channel system message (optional)",
        required: false,
        value: systemMessage,
        style: TextInputStyle.Paragraph,
      })
    );
}

function buildGitHubSettingsModal(channelId: string, userId: string): ModalBuilder {
  const info = getGitHubInfoForUser(userId);
  return new ModalBuilder()
    .setCustomId(`${DISCORD_MODAL_GITHUB}:${channelId}`)
    .setTitle("GitHub Info")
    .addComponents(
      textInputRow({
        id: "github_token",
        label: "GitHub token (optional)",
        required: false,
        value: info?.token || "",
      }),
      textInputRow({
        id: "github_name",
        label: "Git name",
        required: false,
        value: info?.gitName || "",
      }),
      textInputRow({
        id: "github_email",
        label: "Git email",
        required: false,
        value: info?.gitEmail || "",
      })
    );
}

async function handleLauncherButtonInteraction(interaction: any): Promise<boolean> {
  const customId = String(interaction.customId ?? "");
  if (!customId.startsWith("ode:launcher:")) return false;

  const [, , commandRaw, channelIdRaw] = customId.split(":", 4);
  const action = commandRaw as LauncherAction;
  const channelId = channelIdRaw || getResolvedChannelId(interaction);
  if (!channelId) return true;

  if (action === "general") {
    log.info("Discord settings launcher button clicked", {
      action,
      channelId,
      userId: interaction.user.id,
    });
    const payload = buildGeneralSettingsPickerPayload({
      channelId,
      userId: interaction.user.id,
    });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "channel") {
    log.info("Discord settings launcher button clicked", {
      action,
      channelId,
      userId: interaction.user.id,
    });
    const payload = buildChannelSettingsPickerPayload({
      channelId,
      userId: interaction.user.id,
    });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "github") {
    log.info("Discord settings launcher button clicked", {
      action,
      channelId,
      userId: interaction.user.id,
    });
    await interaction.showModal(buildGitHubSettingsModal(channelId, interaction.user.id));
    return true;
  }

  return true;
}

async function handleModalSubmitInteraction(interaction: any): Promise<boolean> {
  const customId = String(interaction.customId ?? "");
  if (!customId.startsWith("ode:modal:")) return false;

  const parts = customId.split(":");
  const modalKind = `${parts[0]}:${parts[1]}:${parts[2]}`;
  const channelId = parts[3] || getResolvedChannelId(interaction);

  if (modalKind === DISCORD_MODAL_CHANNEL) {
    const workingDirectory = getModalValue(interaction, "working_directory").trim();
    const baseBranch = getModalValue(interaction, "base_branch").trim() || "main";
    const channelSystemMessage = getModalValue(interaction, "channel_system_message");
    setChannelWorkingDirectory(channelId, workingDirectory.length > 0 ? workingDirectory : null);
    setChannelBaseBranch(channelId, baseBranch);
    setChannelSystemMessage(channelId, channelSystemMessage);

    await interaction.reply({ content: "Channel settings updated.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (modalKind === DISCORD_MODAL_GITHUB) {
    const token = getModalValue(interaction, "github_token").trim();
    const gitName = getModalValue(interaction, "github_name");
    const gitEmail = getModalValue(interaction, "github_email");
    setGitHubInfoForUser(interaction.user.id, {
      token,
      gitName,
      gitEmail,
    });
    await interaction.reply({ content: "GitHub info updated.", flags: MessageFlags.Ephemeral });
    return true;
  }

  return true;
}

async function handleGeneralSettingsComponentInteraction(interaction: any): Promise<boolean> {
  const customId = String(interaction.customId ?? "");
  if (!customId.startsWith("ode:general:")) return false;

  const [, , action, channelIdRaw] = customId.split(":", 4);
  const channelId = channelIdRaw || getResolvedChannelId(interaction);
  if (!channelId) return true;

  const userId = interaction.user.id;
  const key = draftKey(userId, channelId);
  const draft = getGeneralDraftOrInitial(userId, channelId);

  if (action === "status") {
    const selected = interaction.values?.[0] as string | undefined;
    const parsed = selected ? parseGeneralStatusFormat(selected) : null;
    if (!parsed) {
      await interaction.reply({ content: "Invalid status format.", flags: MessageFlags.Ephemeral });
      return true;
    }
    generalSettingsDrafts.set(key, {
      statusFormat: parsed,
      statusFrequencyMs: draft.statusFrequencyMs,
      gitStrategy: draft.gitStrategy,
      autoUpdate: draft.autoUpdate,
    });
    await interaction.update(buildGeneralSettingsPickerPayload({ channelId, userId }));
    return true;
  }

  if (action === "frequency") {
    const selected = interaction.values?.[0] as string | undefined;
    const parsed = selected ? parseStatusFrequency(selected) : null;
    if (!parsed) {
      await interaction.reply({ content: "Invalid status message frequency.", flags: MessageFlags.Ephemeral });
      return true;
    }
    generalSettingsDrafts.set(key, {
      statusFormat: draft.statusFormat,
      statusFrequencyMs: parsed,
      gitStrategy: draft.gitStrategy,
      autoUpdate: draft.autoUpdate,
    });
    await interaction.update(buildGeneralSettingsPickerPayload({ channelId, userId }));
    return true;
  }

  if (action === "git") {
    const selected = interaction.values?.[0] as string | undefined;
    const parsed = selected ? parseGitStrategy(selected) : null;
    if (!parsed) {
      await interaction.reply({ content: "Invalid git strategy.", flags: MessageFlags.Ephemeral });
      return true;
    }
    generalSettingsDrafts.set(key, {
      statusFormat: draft.statusFormat,
      statusFrequencyMs: draft.statusFrequencyMs,
      gitStrategy: parsed,
      autoUpdate: draft.autoUpdate,
    });
    await interaction.update(buildGeneralSettingsPickerPayload({ channelId, userId }));
    return true;
  }

  if (action === "auto_update") {
    const selected = interaction.values?.[0] as string | undefined;
    const parsed = selected ? parseAutoUpdate(selected) : null;
    if (!parsed) {
      await interaction.reply({ content: "Invalid auto update setting.", flags: MessageFlags.Ephemeral });
      return true;
    }
    generalSettingsDrafts.set(key, {
      statusFormat: draft.statusFormat,
      statusFrequencyMs: draft.statusFrequencyMs,
      gitStrategy: draft.gitStrategy,
      autoUpdate: parsed,
    });
    await interaction.update(buildGeneralSettingsPickerPayload({ channelId, userId }));
    return true;
  }

  if (action === "save") {
    setUserGeneralSettings({
      defaultStatusMessageFormat: draft.statusFormat,
      gitStrategy: draft.gitStrategy,
      statusMessageFrequencyMs: parseStatusMessageFrequencyMs(Number(draft.statusFrequencyMs)),
      autoUpdate: draft.autoUpdate !== "off",
    });
    generalSettingsDrafts.delete(key);
    await interaction.reply({ content: "General settings updated.", flags: MessageFlags.Ephemeral });
    return true;
  }

  return true;
}

async function handleChannelSettingsComponentInteraction(interaction: any): Promise<boolean> {
  const customId = String(interaction.customId ?? "");
  if (!customId.startsWith("ode:channel:")) return false;

  const [, , action, channelIdRaw] = customId.split(":", 4);
  const channelId = channelIdRaw || getResolvedChannelId(interaction);
  if (!channelId) return true;

  const userId = interaction.user.id;
  const key = draftKey(userId, channelId);
  const draft = getDraftOrInitial(userId, channelId);

  if (action === "provider") {
    const selected = interaction.values?.[0] as string | undefined;
    const parsed = selected ? parseProvider(selected) : null;
    if (!parsed || !isAgentEnabled(parsed)) {
      await interaction.reply({ content: "Selected provider is invalid or disabled.", flags: MessageFlags.Ephemeral });
      return true;
    }
    const models = getProviderModels(parsed);
    const nextDraft = {
      provider: parsed,
      model: models.length > 0 ? (findMatchingModel(models, draft.model) ?? models[0]!) : "",
    };
    channelSettingsDrafts.set(key, nextDraft);
    await interaction.update(buildChannelSettingsPickerPayload({ channelId, userId }));
    return true;
  }

  if (action === "model") {
    const selected = interaction.values?.[0] as string | undefined;
    if (selected) {
      channelSettingsDrafts.set(key, {
        provider: draft.provider,
        model: selected,
      });
    }
    await interaction.update(buildChannelSettingsPickerPayload({ channelId, userId }));
    return true;
  }

  if (action === "save") {
    const models = getProviderModels(draft.provider);
    if (models.length > 0 && draft.model && !findMatchingModel(models, draft.model)) {
      await interaction.reply({ content: "Selected model is no longer available.", flags: MessageFlags.Ephemeral });
      return true;
    }

    setChannelAgentProvider(channelId, draft.provider);
    setChannelModel(channelId, resolveStoredModelForProvider({
      provider: draft.provider,
      selectedModel: draft.model,
      lists: getProviderModelLists(),
    }));
    channelSettingsDrafts.delete(key);
    await interaction.reply({ content: "Channel provider/model updated.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (action === "edit") {
    await interaction.showModal(buildChannelSettingsModal(channelId));
    return true;
  }

  return true;
}

async function handleSlashSettingsCommand(interaction: any): Promise<boolean> {
  if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return false;
  const commandName = String(interaction.commandName || "").toLowerCase();
  if (commandName !== "setting" && commandName !== "settings") return false;

  const resolvedChannelId = getResolvedChannelId(interaction);
  log.info("Discord slash settings command received", {
    commandName,
    channelId: resolvedChannelId,
    interactionChannelId: interaction.channelId,
    userId: interaction.user.id,
  });

  await interaction.reply({
    ...buildLauncherReplyPayload("setting", resolvedChannelId),
    flags: MessageFlags.Ephemeral,
  });
  log.info("Discord slash settings command replied", {
    commandName,
    channelId: resolvedChannelId,
    userId: interaction.user.id,
  });
  return true;
}

export async function handleDiscordSettingsInteraction(interaction: any): Promise<boolean> {
  if (interaction.isButton && interaction.isButton()) {
    if (await handleGeneralSettingsComponentInteraction(interaction)) return true;
    if (await handleChannelSettingsComponentInteraction(interaction)) return true;
    if (await handleLauncherButtonInteraction(interaction)) return true;
    return false;
  }

  if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
    if (await handleGeneralSettingsComponentInteraction(interaction)) return true;
    if (await handleChannelSettingsComponentInteraction(interaction)) return true;
    return false;
  }

  if (interaction.isModalSubmit && interaction.isModalSubmit()) {
    return handleModalSubmitInteraction(interaction);
  }

  return handleSlashSettingsCommand(interaction);
}
