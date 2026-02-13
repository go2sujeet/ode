import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { createCoreRuntime } from "@/core/runtime";
import type { IMAdapter } from "@/core/types";
import { createAgentAdapter } from "@/agents/adapter";
import type { OpenCodeMessageContext } from "@/agents";
import {
  getChannelSystemMessage,
  getDiscordBotTokens,
  getDiscordTargetChannels,
  getGitHubInfoForUser,
  getWebHost,
  getWebPort,
} from "@/config";
import { isThreadActive, markThreadActive } from "@/config/local/settings";
import { log } from "@/utils";

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_LAUNCHER_COMMANDS = [
  {
    name: "setting",
    description: "Open Ode settings",
  },
] as const;

let discordClient: Client | null = null;
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
  if (!discordClient) throw new Error("Discord client is not initialized");
  const channel = await discordClient.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Discord channel ${channelId} is not text-based`);
  }
  return channel as any;
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
  _channelId: string,
  messageId: string,
  text: string,
  _asMarkdown = true
): Promise<void> {
  const threadId = statusMessageThreadMap.get(messageId);
  if (!threadId) {
    log.warn("Cannot update Discord message without known thread", { messageId });
    return;
  }
  const channel = await resolveTextChannel(threadId);
  const message = await channel.messages.fetch(messageId);
  await message.edit(splitForDiscord(text)[0] ?? text);
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

function parseLauncherCommand(text: string): "setting" | null {
  const trimmed = text.trim().toLowerCase();
  if (/^\/setting\b/.test(trimmed)) return "setting";
  return null;
}

function getLocalSettingsUrl(): string {
  return `http://${getWebHost()}:${getWebPort()}/local-setting`;
}

type LauncherCommand = "setting" | "channel" | "gh";

function getResolvedChannelId(target: any): string {
  const channel = target?.channel;
  if (channel?.isThread?.()) {
    return channel.parentId ?? target.channelId;
  }
  return target.channelId;
}

function buildLauncherCommandText(params: {
  command: LauncherCommand;
  userId: string;
  channelId: string;
}): string {
  const { command, userId, channelId } = params;
  const settingsUrl = getLocalSettingsUrl();

  if (command === "gh") {
    const hasToken = Boolean(getGitHubInfoForUser(userId)?.token);
    return hasToken
      ? `GitHub token is set for your account. You can update it at ${settingsUrl}.`
      : `No GitHub token set yet. Add it at ${settingsUrl}.`;
  }

  if (command === "channel") {
    return `Open channel settings for channel ${channelId}: ${settingsUrl}`;
  }

  return `Open settings: ${settingsUrl}`;
}

function buildSettingsLinkRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("Open settings")
      .setURL(getLocalSettingsUrl())
  );
}

function buildSettingsChooserRows(channelId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ode:launcher:setting:${channelId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("General setting"),
      new ButtonBuilder()
        .setCustomId(`ode:launcher:channel:${channelId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Channel setting"),
      new ButtonBuilder()
        .setCustomId(`ode:launcher:gh:${channelId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("GitHub info")
    ),
    buildSettingsLinkRow(),
  ];
}

function buildLauncherReplyPayload(params: {
  command: LauncherCommand;
  userId: string;
  channelId: string;
}): { content: string; components: ActionRowBuilder<ButtonBuilder>[] } {
  const { command, userId, channelId } = params;
  if (command === "setting") {
    return {
      content: "Choose which settings page to open.",
      components: buildSettingsChooserRows(channelId),
    };
  }

  return {
    content: buildLauncherCommandText({ command, userId, channelId }),
    components: [buildSettingsLinkRow()],
  };
}

async function handleLauncherButtonInteraction(interaction: any): Promise<void> {
  const customId = String(interaction.customId ?? "");
  if (!customId.startsWith("ode:launcher:")) return;

  const [, , commandRaw, channelIdRaw] = customId.split(":", 4);
  const command = commandRaw as LauncherCommand;
  if (!["setting", "channel", "gh"].includes(command)) return;

  const channelId = channelIdRaw || getResolvedChannelId(interaction);
  const payload = buildLauncherReplyPayload({
    command,
    userId: interaction.user.id,
    channelId,
  });

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ ...payload, ephemeral: true });
    return;
  }

  await interaction.reply({ ...payload, ephemeral: true });
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
  if (discordClient) return true;
  const configuredTokens = getDiscordBotTokens();
  const token = configuredTokens[0]?.token?.trim() || process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    log.debug("Discord runtime skipped (Discord bot token missing)", { reason });
    return false;
  }

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
        name: `ode-${Date.now()}`,
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
  discordClient = client;
  log.info("Discord runtime started", { reason, botUserId: client.user?.id ?? "unknown" });
  return true;
}

export async function stopDiscordRuntime(reason: string): Promise<void> {
  if (!discordClient) return;
  discordClient.destroy();
  discordClient = null;
  statusMessageThreadMap.clear();
  log.debug("Discord runtime stopped", { reason });
}
