import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
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
import { isThreadActive, markThreadActive } from "@/config/local/settings";
import { log } from "@/utils";

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_THREAD_NAME_LIMIT = 100;
const DISCORD_MODAL_GENERAL = "ode:modal:general";
const DISCORD_MODAL_CHANNEL = "ode:modal:channel";
const DISCORD_MODAL_GITHUB = "ode:modal:github";
const PROVIDERS = ["opencode", "claudecode", "codex", "kimi", "kiro", "kilo", "qwen"] as const;
const DISCORD_LAUNCHER_COMMANDS = [
  {
    name: "setting",
    description: "Open Ode settings",
  },
] as const;

const discordClients = new Map<string, Client>();
const statusMessageThreadMap = new Map<string, string>();

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
    const threadId = statusMessageThreadMap.get(messageId) || channelId;
    if (!threadId) {
      log.warn("Cannot update Discord message without known thread", { messageId });
      return;
    }
    const channel = await resolveTextChannel(threadId);
    const message = await channel.messages.fetch(messageId);
    await message.edit(splitForDiscord(text)[0] ?? text);
  } catch (error) {
    log.warn("Failed to update Discord message", {
      messageId,
      channelId,
      error: String(error),
    });
  }
}

async function deleteMessage(_channelId: string, messageId: string): Promise<void> {
  const threadId = statusMessageThreadMap.get(messageId);
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
  sendMessage,
  updateMessage,
  deleteMessage,
  fetchThreadHistory,
  buildAgentContext: async ({ channelId, threadId, userId, threadHistory }) =>
    buildDiscordContext(channelId, threadId, userId, threadHistory),
};

const coreRuntime = createCoreRuntime({
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

function buildGeneralSettingsModal(channelId: string): ModalBuilder {
  const settings = getUserGeneralSettings();
  return new ModalBuilder()
    .setCustomId(`${DISCORD_MODAL_GENERAL}:${channelId}`)
    .setTitle("General Settings")
    .addComponents(
      textInputRow({
        id: "status_format",
        label: "Status format",
        required: true,
        value: settings.defaultStatusMessageFormat,
        placeholder: "aggressive | medium | minimum",
      }),
      textInputRow({
        id: "git_strategy",
        label: "Git strategy",
        required: true,
        value: settings.gitStrategy,
        placeholder: "worktree | default",
      })
    );
}

function buildChannelSettingsModal(channelId: string): ModalBuilder {
  const provider = getChannelAgentProvider(channelId);
  const model = getChannelModel(channelId) || "";
  const baseBranch = getChannelBaseBranch(channelId) || "main";
  const workingDirectory = resolveChannelCwd(channelId).workingDirectory || "";
  const systemMessage = getChannelSystemMessage(channelId) || "";

  return new ModalBuilder()
    .setCustomId(`${DISCORD_MODAL_CHANNEL}:${channelId}`)
    .setTitle("Channel Settings")
    .addComponents(
      textInputRow({
        id: "provider",
        label: "Provider",
        required: true,
        value: provider,
        placeholder: PROVIDERS.join(" | "),
      }),
      textInputRow({
        id: "model",
        label: "Model (optional)",
        required: false,
        value: model,
        placeholder: "Model id or blank",
      }),
      textInputRow({
        id: "working_directory",
        label: "Working directory (optional)",
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
    await interaction.showModal(buildGeneralSettingsModal(channelId));
    return;
  }

  if (action === "channel") {
    await interaction.showModal(buildChannelSettingsModal(channelId));
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

  if (modalKind === DISCORD_MODAL_GENERAL) {
    const statusFormat = parseGeneralStatusFormat(getModalValue(interaction, "status_format"));
    const gitStrategy = parseGitStrategy(getModalValue(interaction, "git_strategy"));
    if (!statusFormat || !gitStrategy) {
      await interaction.reply({
        content: "Invalid values. Status format: aggressive|medium|minimum. Git strategy: worktree|default.",
        ephemeral: true,
      });
      return;
    }
    setUserGeneralSettings({
      defaultStatusMessageFormat: statusFormat,
      gitStrategy,
    });
    await interaction.reply({ content: "General settings updated.", ephemeral: true });
    return;
  }

  if (modalKind === DISCORD_MODAL_CHANNEL) {
    const providerInput = getModalValue(interaction, "provider");
    const provider = parseProvider(providerInput);
    if (!provider || !isAgentEnabled(provider)) {
      await interaction.reply({
        content: `Invalid provider. Use one of: ${PROVIDERS.join(", ")}.`,
        ephemeral: true,
      });
      return;
    }

    const modelInput = getModalValue(interaction, "model").trim();
    if (provider === "opencode" && modelInput && !hasModel(getOpenCodeModels(), modelInput)) {
      await interaction.reply({ content: "Model is not in OpenCode models list.", ephemeral: true });
      return;
    }
    if (provider === "codex" && modelInput && !hasModel(getCodexModels(), modelInput)) {
      await interaction.reply({ content: "Model is not in Codex models list.", ephemeral: true });
      return;
    }
    if (provider === "kilo" && modelInput && !hasModel(getKiloModels(), modelInput)) {
      await interaction.reply({ content: "Model is not in Kilo models list.", ephemeral: true });
      return;
    }

    const workingDirectory = getModalValue(interaction, "working_directory").trim();
    const baseBranch = getModalValue(interaction, "base_branch").trim() || "main";
    const channelSystemMessage = getModalValue(interaction, "channel_system_message");

    setChannelAgentProvider(channelId, provider);
    if (provider === "claudecode" || provider === "kimi" || provider === "kiro" || provider === "qwen") {
      setChannelModel(channelId, "");
    } else {
      setChannelModel(channelId, modelInput);
    }
    setChannelWorkingDirectory(channelId, workingDirectory.length > 0 ? workingDirectory : null);
    setChannelBaseBranch(channelId, baseBranch);
    setChannelSystemMessage(channelId, channelSystemMessage);

    await interaction.reply({ content: "Channel settings updated.", ephemeral: true });
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
    await interaction.reply({ content: "GitHub info updated.", ephemeral: true });
  }
}

async function registerDiscordCommands(client: Client): Promise<void> {
  try {
    const guilds = await client.guilds.fetch();
    for (const [, guildPreview] of guilds) {
      const guild = await client.guilds.fetch(guildPreview.id);
      await guild.commands.set([...DISCORD_LAUNCHER_COMMANDS]);
    }
    log.info("Discord slash commands registered", { count: DISCORD_LAUNCHER_COMMANDS.length });
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

          if (message.channel.isThread()) {
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
        await handleLauncherButtonInteraction(interaction);
        return;
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
            ephemeral: true,
          });
        } catch (error) {
          log.error("Discord interaction handler failed", { error: String(error) });
        }
      });

      await client.login(token);
      await registerDiscordCommands(client);
      discordClients.set(token, client);
      startedCount += 1;
      log.info("Discord runtime started", {
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
