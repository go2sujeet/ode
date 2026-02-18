import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createCoreRuntime } from "@/core/runtime";
import type { IMAdapter } from "@/core/types";
import { createAgentAdapter } from "@/agents/adapter";
import type { OpenCodeMessageContext } from "@/agents";
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
  getDiscordBotTokens,
  getDiscordTargetChannels,
  getGitHubInfoForUser,
  getUserGeneralSettings,
  setGitHubInfoForUser,
  setUserGeneralSettings,
} from "@/config";
import { findReplyThreadIdByStatusMessageTs } from "@/config/local/sessions";
import { isThreadActive, markThreadActive } from "@/config/local/settings";
import { log } from "@/utils";

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_THREAD_NAME_LIMIT = 25;
const DISCORD_THREAD_RENAME_LIMIT = 90;
const DISCORD_MODAL_CHANNEL = "ode:modal:channel_details";
const DISCORD_MODAL_GITHUB = "ode:modal:github";
const STATUS_FORMAT_OPTIONS = ["aggressive", "medium", "minimum"] as const;
const GIT_STRATEGY_OPTIONS = ["worktree", "default"] as const;
const PROVIDERS = ["opencode", "claudecode", "codex", "kimi", "kiro", "kilo", "qwen", "goose"] as const;
const DISCORD_LAUNCHER_COMMANDS = [
  {
    name: "setting",
    description: "Open Ode settings",
  },
] as const;

const discordClients = new Map<string, Client>();
const statusMessageThreadMap = new Map<string, string>();
const channelSettingsDrafts = new Map<string, { provider: typeof PROVIDERS[number]; model: string }>();
const generalSettingsDrafts = new Map<string, {
  statusFormat: typeof STATUS_FORMAT_OPTIONS[number];
  gitStrategy: typeof GIT_STRATEGY_OPTIONS[number];
}>();

function splitForDiscord(text: string): string[] {
  if (text.length <= DISCORD_MESSAGE_LIMIT) return [text];
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.slice(index, index + DISCORD_MESSAGE_LIMIT));
    index += DISCORD_MESSAGE_LIMIT;
  }
  return chunks;
}

async function resolveTextChannel(channelId: string) {
  for (const client of discordClients.values()) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        return channel as any;
      }
    } catch {
      // Try next client
    }
  }

  throw new Error(`Discord channel ${channelId} is not text-based or inaccessible`);
}

async function buildDiscordContext(
  channelId: string,
  threadId: string,
  userId: string,
  threadHistory?: string | null
): Promise<OpenCodeMessageContext> {
  return {
    threadHistory: threadHistory || undefined,
    slack: {
      platform: "discord",
      channelId,
      threadId,
      userId,
      threadHistory: threadHistory || undefined,
      hasCustomSlackTool: false,
      hasGitHubToken: Boolean(getGitHubInfoForUser(userId)?.token),
      channelSystemMessage: getChannelSystemMessage(channelId) ?? undefined,
    },
  };
}

async function sendMessage(
  _channelId: string,
  threadId: string,
  text: string,
  _asMarkdown = true
): Promise<string | undefined> {
  const channel = await resolveTextChannel(threadId);
  const chunks = splitForDiscord(text);
  let firstId: string | undefined;
  for (const chunk of chunks) {
    const sent = await channel.send(chunk);
    firstId = firstId || sent.id;
    statusMessageThreadMap.set(sent.id, threadId);
  }
  return firstId;
}

async function updateMessage(
  channelId: string,
  messageId: string,
  text: string,
  _asMarkdown = true
): Promise<void> {
  try {
    const mappedThreadId = statusMessageThreadMap.get(messageId);
    const persistedThreadId = findReplyThreadIdByStatusMessageTs(messageId);
    const threadId = mappedThreadId || persistedThreadId || channelId;
    if (!threadId) {
      log.warn("Cannot update Discord message without known thread", { messageId });
      return;
    }
    if (!mappedThreadId && persistedThreadId) {
      statusMessageThreadMap.set(messageId, persistedThreadId);
    }
    const channel = await resolveTextChannel(threadId);
    const message = await channel.messages.fetch(messageId);
    await message.edit(splitForDiscord(text)[0] ?? text);
  } catch (error) {
    log.warn("Failed to update Discord message", {
      messageId,
      channelId,
      resolvedChannelId: statusMessageThreadMap.get(messageId) || findReplyThreadIdByStatusMessageTs(messageId) || channelId,
      error: String(error),
    });
  }
}

async function deleteMessage(_channelId: string, messageId: string): Promise<void> {
  const threadId = statusMessageThreadMap.get(messageId) || findReplyThreadIdByStatusMessageTs(messageId);
  if (!threadId) return;
  const channel = await resolveTextChannel(threadId);
  const message = await channel.messages.fetch(messageId);
  await message.delete();
}

async function fetchThreadHistory(
  _channelId: string,
  threadId: string,
  messageId: string
): Promise<string | null> {
  try {
    const channel = await resolveTextChannel(threadId);
    const history = await channel.messages.fetch({ limit: 20, before: messageId });
    const ordered = Array.from(history.values() as Iterable<any>).reverse();
    const lines = ordered
      .filter((message: any) => !message.author.bot)
      .map((message: any) => `${message.author.username}: ${message.content}`)
      .filter((line) => line.trim().length > 0);
    return lines.length > 0 ? lines.join("\n") : null;
  } catch {
    return null;
  }
}

const discordAdapter: IMAdapter = {
  maxEditableMessageChars: DISCORD_MESSAGE_LIMIT,
  sendMessage,
  updateMessage,
  deleteMessage,
  fetchThreadHistory,
  renameThread: renameDiscordThread,
  buildAgentContext: async ({ channelId, threadId, userId, threadHistory }) =>
    buildDiscordContext(channelId, threadId, userId, threadHistory),
};

const coreRuntime = createCoreRuntime({
  platform: "discord",
  im: discordAdapter,
  agent: createAgentAdapter(),
});

function cleanBotMention(content: string, botUserId: string): string {
  const mentionPatterns = [
    new RegExp(`<@${botUserId}>`, "g"),
    new RegExp(`<@!${botUserId}>`, "g"),
  ];
  let text = content;
  for (const pattern of mentionPatterns) {
    text = text.replace(pattern, " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

function isStopCommand(text: string): boolean {
  return text.trim().toLowerCase() === "stop";
}

function isTopLevelMessage(message: any): boolean {
  return !message.channel?.isThread?.();
}

function buildMeaningfulThreadName(text: string): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[`*_~>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return `thread-${Date.now()}`;
  }

  return cleaned.slice(0, DISCORD_THREAD_NAME_LIMIT).trim();
}

function formatThreadNameFromBranch(branchName: string): string {
  const trimmed = branchName.trim();
  if (!trimmed) return "";
  const normalized = trimmed
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return normalized.slice(0, DISCORD_THREAD_RENAME_LIMIT);
}

async function renameDiscordThread(
  channelId: string,
  threadId: string,
  branchName: string
): Promise<void> {
  const targetName = formatThreadNameFromBranch(branchName);
  if (!targetName) return;

  try {
    const channel = await resolveTextChannel(threadId);
    if (channel && typeof (channel as any).setName === "function") {
      if ((channel as any).name === targetName) return;
      await (channel as any).setName(targetName);
    }
  } catch (error) {
    log.warn("Failed to rename Discord thread", {
      channelId,
      threadId,
      branchName,
      error: String(error),
    });
  }
}

function parseLauncherCommand(text: string): "setting" | null {
  const trimmed = text.trim().toLowerCase();
  if (/^\/setting\b/.test(trimmed)) return "setting";
  return null;
}

type LauncherCommand = "setting";
type LauncherAction = "general" | "channel" | "github";

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

function buildLauncherReplyPayload(params: {
  command: LauncherCommand;
  userId: string;
  channelId: string;
}): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  const { command, channelId } = params;
  return {
    content: command === "setting" ? "Choose what to configure in Discord:" : "Choose settings action:",
    components: buildSettingsChooserRows(channelId),
  };
}

function getModalValue(interaction: any, fieldId: string): string {
  return interaction.fields.getTextInputValue(fieldId) || "";
}

function parseProvider(value: string): typeof PROVIDERS[number] | null {
  const normalized = value.trim().toLowerCase();
  if (!PROVIDERS.includes(normalized as typeof PROVIDERS[number])) return null;
  return normalized as typeof PROVIDERS[number];
}

function normalizeModel(value: string): string {
  return value.trim().toLowerCase();
}

function hasModel(models: string[], selected: string): boolean {
  const target = normalizeModel(selected);
  return models.some((model) => normalizeModel(model) === target);
}

function getProviderModels(provider: typeof PROVIDERS[number]): string[] {
  if (provider === "opencode") return getOpenCodeModels();
  if (provider === "codex") return getCodexModels();
  if (provider === "kilo") return getKiloModels();
  return [];
}

function draftKey(userId: string, channelId: string): string {
  return `${userId}:${channelId}`;
}

function getInitialChannelDraft(channelId: string): { provider: typeof PROVIDERS[number]; model: string } {
  const provider = getChannelAgentProvider(channelId);
  return {
    provider,
    model: getChannelModel(channelId) || "",
  };
}

function getDraftOrInitial(userId: string, channelId: string): { provider: typeof PROVIDERS[number]; model: string } {
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
    const selectedModel = draft.model && hasModel(models, draft.model) ? draft.model : models[0]!;
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

function getInitialGeneralDraft(): {
  statusFormat: typeof STATUS_FORMAT_OPTIONS[number];
  gitStrategy: typeof GIT_STRATEGY_OPTIONS[number];
} {
  const settings = getUserGeneralSettings();
  return {
    statusFormat: settings.defaultStatusMessageFormat,
    gitStrategy: settings.gitStrategy,
  };
}

function getGeneralDraftOrInitial(userId: string, channelId: string): {
  statusFormat: typeof STATUS_FORMAT_OPTIONS[number];
  gitStrategy: typeof GIT_STRATEGY_OPTIONS[number];
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

  return {
    content: `General settings (draft)\nStatus: ${draft.statusFormat}\nGit strategy: ${draft.gitStrategy}`,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(statusSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(gitSelect),
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

async function handleLauncherButtonInteraction(interaction: any): Promise<void> {
  const customId = String(interaction.customId ?? "");
  if (!customId.startsWith("ode:launcher:")) return;

  const [, , commandRaw, channelIdRaw] = customId.split(":", 4);
  const action = commandRaw as LauncherAction;
  const channelId = channelIdRaw || getResolvedChannelId(interaction);
  if (!channelId) return;

  if (action === "general") {
    const payload = buildGeneralSettingsPickerPayload({
      channelId,
      userId: interaction.user.id,
    });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "channel") {
    const payload = buildChannelSettingsPickerPayload({
      channelId,
      userId: interaction.user.id,
    });
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "github") {
    await interaction.showModal(buildGitHubSettingsModal(channelId, interaction.user.id));
  }
}

async function handleModalSubmitInteraction(interaction: any): Promise<void> {
  const customId = String(interaction.customId ?? "");
  if (!customId.startsWith("ode:modal:")) return;

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
    return;
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
  }
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
      gitStrategy: draft.gitStrategy,
    });
    const payload = buildGeneralSettingsPickerPayload({ channelId, userId });
    await interaction.update(payload);
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
      gitStrategy: parsed,
    });
    const payload = buildGeneralSettingsPickerPayload({ channelId, userId });
    await interaction.update(payload);
    return true;
  }

  if (action === "save") {
    setUserGeneralSettings({
      defaultStatusMessageFormat: draft.statusFormat,
      gitStrategy: draft.gitStrategy,
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
      model: models.length > 0 ? (hasModel(models, draft.model) ? draft.model : models[0]!) : "",
    };
    channelSettingsDrafts.set(key, nextDraft);
    const payload = buildChannelSettingsPickerPayload({ channelId, userId });
    await interaction.update(payload);
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
    const payload = buildChannelSettingsPickerPayload({ channelId, userId });
    await interaction.update(payload);
    return true;
  }

  if (action === "save") {
    const models = getProviderModels(draft.provider);
    if (models.length > 0 && draft.model && !hasModel(models, draft.model)) {
      await interaction.reply({ content: "Selected model is no longer available.", flags: MessageFlags.Ephemeral });
      return true;
    }

    setChannelAgentProvider(channelId, draft.provider);
    if (draft.provider === "claudecode" || draft.provider === "kimi" || draft.provider === "kiro" || draft.provider === "qwen" || draft.provider === "goose") {
      setChannelModel(channelId, "");
    } else {
      setChannelModel(channelId, draft.model);
    }
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

async function registerDiscordCommands(client: Client): Promise<void> {
  try {
    const guilds = await client.guilds.fetch();
    for (const [, guildPreview] of guilds) {
      const guild = await client.guilds.fetch(guildPreview.id);
      await guild.commands.set([...DISCORD_LAUNCHER_COMMANDS]);
    }
    log.debug("Discord slash commands registered", { count: DISCORD_LAUNCHER_COMMANDS.length });
  } catch (error) {
    log.warn("Failed to register Discord slash commands", { error: String(error) });
  }
}

export async function startDiscordRuntime(reason: string): Promise<boolean> {
  if (discordClients.size > 0) return true;
  const configuredTokens = getDiscordBotTokens();
  const envToken = process.env.DISCORD_BOT_TOKEN?.trim() || "";
  const tokens = Array.from(new Set([
    ...configuredTokens.map((entry) => entry.token?.trim() || "").filter(Boolean),
    ...(envToken ? [envToken] : []),
  ]));

  if (tokens.length === 0) {
    log.debug("Discord runtime skipped (Discord bot token missing)", { reason });
    return false;
  }

  let startedCount = 0;

  for (const token of tokens) {
    try {
      const client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      client.on("messageCreate", async (message: any) => {
        try {
          if (!client.user) return;
          if (message.author.bot) return;
          if (!message.guildId) return;

          const configuredChannels = getDiscordTargetChannels();

          if (!isTopLevelMessage(message)) {
            const parentId = message.channel.parentId;
            if (!parentId) return;
            if (configuredChannels && !configuredChannels.includes(parentId)) return;

            const threadId = message.channel.id;
            const text = message.content.trim();
            const launcherCommand = parseLauncherCommand(text);
            if (launcherCommand) {
              log.debug("Ignoring Discord message command in thread; slash command handles it", {
                command: launcherCommand,
                threadId,
              });
              return;
            }
            const mentioned = message.mentions.users.has(client.user.id);
            const active = isThreadActive(parentId, threadId);
            if (!mentioned && !active) return;
            if (!text) return;

            if (isStopCommand(text)) {
              const stopped = await coreRuntime.handleStopCommand(parentId, threadId);
              if (stopped) {
                await message.channel.send("Request stopped.");
              }
              return;
            }

            markThreadActive(parentId, threadId);
            await coreRuntime.handleIncomingMessage({
              channelId: parentId,
              replyThreadId: threadId,
              threadId,
              userId: message.author.id,
              messageId: message.id,
            }, text);
            return;
          }

          const parentId = message.channel.id;
          if (configuredChannels && !configuredChannels.includes(parentId)) return;

          const parentLauncherCommand = parseLauncherCommand(message.content);
          if (parentLauncherCommand) {
            log.debug("Ignoring Discord message command in parent channel; slash command handles it", {
              command: parentLauncherCommand,
              channelId: parentId,
            });
            return;
          }

          const isMentioned = message.mentions.users.has(client.user.id);
          if (!isMentioned) return;

          const cleaned = cleanBotMention(message.content, client.user.id);
          const cleanedLauncherCommand = parseLauncherCommand(cleaned);
          if (cleanedLauncherCommand) {
            log.debug("Ignoring Discord mention command; slash command handles it", {
              command: cleanedLauncherCommand,
              channelId: parentId,
            });
            return;
          }
          if (!cleaned) {
            await message.reply("Please include a request after mentioning me.");
            return;
          }

      const thread = await message.startThread({
        name: buildMeaningfulThreadName(cleaned),
        autoArchiveDuration: 60,
      });

          markThreadActive(parentId, thread.id);
          await coreRuntime.handleIncomingMessage({
            channelId: parentId,
            replyThreadId: thread.id,
            threadId: thread.id,
            userId: message.author.id,
            messageId: message.id,
          }, cleaned);
        } catch (error) {
          log.error("Discord message handler failed", { error: String(error) });
        }
      });

      client.on("interactionCreate", async (interaction: any) => {
        try {
      if (interaction.isButton && interaction.isButton()) {
        if (await handleGeneralSettingsComponentInteraction(interaction)) return;
        if (await handleChannelSettingsComponentInteraction(interaction)) return;
        await handleLauncherButtonInteraction(interaction);
        return;
      }

      if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
        if (await handleGeneralSettingsComponentInteraction(interaction)) return;
        if (await handleChannelSettingsComponentInteraction(interaction)) return;
      }

      if (interaction.isModalSubmit && interaction.isModalSubmit()) {
        await handleModalSubmitInteraction(interaction);
        return;
      }

          if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;
          const commandName = String(interaction.commandName || "").toLowerCase();
          if (commandName !== "setting") return;

          const payload = buildLauncherReplyPayload({
            command: commandName as LauncherCommand,
            userId: interaction.user.id,
            channelId: getResolvedChannelId(interaction),
          });

          await interaction.reply({
            ...payload,
            flags: MessageFlags.Ephemeral,
          });
        } catch (error) {
          log.error("Discord interaction handler failed", { error: String(error) });
        }
      });

      await client.login(token);
      await registerDiscordCommands(client);
      discordClients.set(token, client);
      startedCount += 1;
      log.debug("Discord runtime started", {
        reason,
        botUserId: client.user?.id ?? "unknown",
      });
    } catch (error) {
      log.error("Discord runtime failed for token", { reason, error: String(error) });
    }
  }

  return startedCount > 0;
}

export async function stopDiscordRuntime(reason: string): Promise<void> {
  if (discordClients.size === 0) return;
  for (const client of discordClients.values()) {
    client.destroy();
  }
  discordClients.clear();
  statusMessageThreadMap.clear();
  log.debug("Discord runtime stopped", { reason });
}

export const recoverPendingRequests = coreRuntime.recoverPendingRequests;
