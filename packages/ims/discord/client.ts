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
import { isStopCommand } from "@/ims/shared/stop-command";
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
  STATUS_MESSAGE_FREQUENCY_OPTIONS,
  parseStatusMessageFrequencyValue,
  parseStatusMessageFrequencyMs,
  toStatusMessageFrequencyValue,
  type StatusMessageFrequencyValue,
} from "@/config";
import { findReplyThreadIdByStatusMessageTs } from "@/config/local/sessions";
import { isThreadActive, markThreadActive } from "@/config/local/settings";
import { log } from "@/utils";
import {
  shouldProcessIncomingMessage,
  toCoreMessageContext,
  type UnifiedMessageContext,
} from "@/ims/shared/message-context";

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_THREAD_NAME_LIMIT = 25;
const DISCORD_THREAD_RENAME_LIMIT = 90;
const DISCORD_MODAL_CHANNEL = "ode:modal:channel_details";
const DISCORD_MODAL_GITHUB = "ode:modal:github";
const STATUS_FORMAT_OPTIONS = ["aggressive", "medium", "minimum"] as const;
const STATUS_FREQUENCY_OPTIONS: StatusMessageFrequencyValue[] =
  STATUS_MESSAGE_FREQUENCY_OPTIONS.map((option) => option.value);
const GIT_STRATEGY_OPTIONS = ["worktree", "default"] as const;
const AUTO_UPDATE_OPTIONS = ["on", "off"] as const;
const PROVIDERS = ["opencode", "claudecode", "codex", "kimi", "kiro", "kilo", "qwen", "goose", "gemini"] as const;
const DISCORD_LAUNCHER_COMMANDS = [
  {
    name: "setting",
    description: "Open Ode settings",
  },
  {
    name: "settings",
    description: "Open Ode settings",
  },
] as const;

const discordClients = new Map<string, Client>();
const statusMessageThreadMap = new Map<string, string>();
let discordStartPromise: Promise<boolean> | null = null;
const channelSettingsDrafts = new Map<string, { provider: typeof PROVIDERS[number]; model: string }>();
const generalSettingsDrafts = new Map<string, {
  statusFormat: typeof STATUS_FORMAT_OPTIONS[number];
  statusFrequencyMs: StatusMessageFrequencyValue;
  gitStrategy: typeof GIT_STRATEGY_OPTIONS[number];
  autoUpdate: typeof AUTO_UPDATE_OPTIONS[number];
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
    const statusTitle = extractStatusTitleForDiscord(text);
    if (statusTitle && typeof (channel as any).setName === "function" && (channel as any).name !== statusTitle) {
      await (channel as any).setName(statusTitle);
      log.debug("Discord thread renamed from live status title", {
        channelId,
        threadId,
        messageId,
        statusTitle,
      });
    }
  } catch (error) {
    const message = String(error);
    log.warn("Failed to update Discord message", {
      messageId,
      channelId,
      resolvedChannelId: statusMessageThreadMap.get(messageId) || findReplyThreadIdByStatusMessageTs(messageId) || channelId,
      error: message,
    });
    const normalized = message.toLowerCase();
    if (normalized.includes("429") || normalized.includes("rate limit") || normalized.includes("ratelimit")) {
      throw error;
    }
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

function isBotMentioned(message: any, botUserId: string): boolean {
  if (message?.mentions?.users?.has?.(botUserId)) return true;
  const content = typeof message?.content === "string" ? message.content : "";
  return content.includes(`<@${botUserId}>`) || content.includes(`<@!${botUserId}>`);
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

function formatThreadNameFromStatusTitle(title: string): string {
  const normalized = title
    .replace(/[\r\n]+/g, " ")
    .replace(/[`*_~>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.slice(0, DISCORD_THREAD_RENAME_LIMIT).trim();
}

function extractStatusTitleForDiscord(text: string): string | null {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || "";
  if (!firstLine.startsWith("*")) return null;
  const matched = firstLine.match(/^\*([^*]+)\*\s*(?:\(|$)/);
  if (!matched?.[1]) return null;
  const title = formatThreadNameFromStatusTitle(matched[1]);
  return title || null;
}

async function renameDiscordThread(
  channelId: string,
  threadId: string,
  name: string
): Promise<void> {
  const looksLikeBranch = /^[a-z0-9._\/-]+$/i.test(name.trim());
  const targetName = looksLikeBranch
    ? formatThreadNameFromBranch(name)
    : formatThreadNameFromStatusTitle(name);
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
      name,
      error: String(error),
    });
  }
}

function parseLauncherCommand(text: string): "setting" | null {
  const trimmed = text.trim().toLowerCase();
  if (/^\/?settings?\b/.test(trimmed)) return "setting";
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

async function sendLauncherReplyForMessage(params: {
  message: any;
  command: LauncherCommand;
  channelId: string;
}): Promise<void> {
  const payload = buildLauncherReplyPayload({
    command: params.command,
    userId: params.message.author.id,
    channelId: params.channelId,
  });
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

async function handleLauncherButtonInteraction(interaction: any): Promise<void> {
  const customId = String(interaction.customId ?? "");
  if (!customId.startsWith("ode:launcher:")) return;

  const [, , commandRaw, channelIdRaw] = customId.split(":", 4);
  const action = commandRaw as LauncherAction;
  const channelId = channelIdRaw || getResolvedChannelId(interaction);
  if (!channelId) return;

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
    return;
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
    return;
  }

  if (action === "github") {
    log.info("Discord settings launcher button clicked", {
      action,
      channelId,
      userId: interaction.user.id,
    });
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
      statusFrequencyMs: draft.statusFrequencyMs,
      gitStrategy: draft.gitStrategy,
      autoUpdate: draft.autoUpdate,
    });
    const payload = buildGeneralSettingsPickerPayload({ channelId, userId });
    await interaction.update(payload);
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
      statusFrequencyMs: draft.statusFrequencyMs,
      gitStrategy: parsed,
      autoUpdate: draft.autoUpdate,
    });
    const payload = buildGeneralSettingsPickerPayload({ channelId, userId });
    await interaction.update(payload);
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
    const payload = buildGeneralSettingsPickerPayload({ channelId, userId });
    await interaction.update(payload);
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
    if (draft.provider === "claudecode" || draft.provider === "kimi" || draft.provider === "kiro" || draft.provider === "qwen" || draft.provider === "goose" || draft.provider === "gemini") {
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

async function startDiscordRuntimeInternal(reason: string): Promise<boolean> {
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
  log.debug("Discord runtime starting", {
    reason,
    tokenCount: tokens.length,
  });

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
              await sendLauncherReplyForMessage({
                message,
                command: launcherCommand,
                channelId: parentId,
              });
              log.debug("Handled Discord message settings command in thread", {
                command: launcherCommand,
                threadId,
              });
              return;
            }
            const mentioned = isBotMentioned(message, client.user.id);
            const active = isThreadActive(parentId, threadId);
            const messageContext: UnifiedMessageContext = {
              platform: "discord",
              channelId: parentId,
              threadId,
              replyThreadId: threadId,
              messageId: message.id,
              userId: message.author.id,
              isTopLevel: false,
              mentionedBot: mentioned,
              activeThread: active,
              rawText: text,
              normalizedText: mentioned ? cleanBotMention(text, client.user.id) : text,
            };
            if (!shouldProcessIncomingMessage(messageContext)) return;
            if (!messageContext.normalizedText) {
              if (mentioned) {
                await message.reply("Please include a request after mentioning me.");
              }
              return;
            }

            if (isStopCommand(messageContext.normalizedText)) {
              const stopped = await coreRuntime.handleStopCommand(parentId, threadId);
              if (stopped) {
                await message.channel.send("Request stopped.");
              }
              return;
            }

            markThreadActive(parentId, threadId);
            await coreRuntime.handleIncomingMessage(
              toCoreMessageContext(messageContext),
              messageContext.normalizedText
            );
            return;
          }

          const parentId = message.channel.id;
          if (configuredChannels && !configuredChannels.includes(parentId)) return;

          const parentLauncherCommand = parseLauncherCommand(message.content);
          if (parentLauncherCommand) {
            await sendLauncherReplyForMessage({
              message,
              command: parentLauncherCommand,
              channelId: parentId,
            });
            log.debug("Handled Discord message settings command in parent channel", {
              command: parentLauncherCommand,
              channelId: parentId,
            });
            return;
          }

          const topLevelContext: UnifiedMessageContext = {
            platform: "discord",
            channelId: parentId,
            threadId: message.id,
            replyThreadId: message.id,
            messageId: message.id,
            userId: message.author.id,
            isTopLevel: true,
            mentionedBot: isBotMentioned(message, client.user.id),
            activeThread: false,
            rawText: message.content,
            normalizedText: cleanBotMention(message.content, client.user.id),
          };
          if (!shouldProcessIncomingMessage(topLevelContext)) return;

          const cleanedLauncherCommand = parseLauncherCommand(topLevelContext.normalizedText);
          if (cleanedLauncherCommand) {
            await sendLauncherReplyForMessage({
              message,
              command: cleanedLauncherCommand,
              channelId: parentId,
            });
            log.debug("Handled Discord mention settings command", {
              command: cleanedLauncherCommand,
              channelId: parentId,
            });
            return;
          }
          if (!topLevelContext.normalizedText) {
            await message.reply("Please include a request after mentioning me.");
            return;
          }

      const thread = await message.startThread({
        name: buildMeaningfulThreadName(topLevelContext.normalizedText),
        autoArchiveDuration: 60,
      });

          markThreadActive(parentId, thread.id);
          await coreRuntime.handleIncomingMessage(
            toCoreMessageContext({
              ...topLevelContext,
              threadId: thread.id,
              replyThreadId: thread.id,
            }),
            topLevelContext.normalizedText
          );
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
          if (commandName !== "setting" && commandName !== "settings") return;

          const resolvedChannelId = getResolvedChannelId(interaction);
          log.info("Discord slash settings command received", {
            commandName,
            channelId: resolvedChannelId,
            interactionChannelId: interaction.channelId,
            userId: interaction.user.id,
          });

          const payload = buildLauncherReplyPayload({
            command: "setting",
            userId: interaction.user.id,
            channelId: resolvedChannelId,
          });

          await interaction.reply({
            ...payload,
            flags: MessageFlags.Ephemeral,
          });
          log.info("Discord slash settings command replied", {
            commandName,
            channelId: resolvedChannelId,
            userId: interaction.user.id,
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

export async function startDiscordRuntime(reason: string): Promise<boolean> {
  if (discordClients.size > 0) {
    log.debug("Discord runtime start skipped; already running", {
      reason,
      clientCount: discordClients.size,
    });
    return true;
  }
  if (discordStartPromise) {
    log.debug("Discord runtime start already in progress; waiting", { reason });
    return discordStartPromise;
  }

  discordStartPromise = startDiscordRuntimeInternal(reason)
    .finally(() => {
      discordStartPromise = null;
    });
  return discordStartPromise;
}

export async function stopDiscordRuntime(reason: string): Promise<void> {
  discordStartPromise = null;
  if (discordClients.size === 0) return;
  for (const client of discordClients.values()) {
    client.destroy();
  }
  discordClients.clear();
  statusMessageThreadMap.clear();
  log.debug("Discord runtime stopped", { reason });
}

export const recoverPendingRequests = coreRuntime.recoverPendingRequests;
