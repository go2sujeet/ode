import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { createCoreRuntime } from "@/core/runtime";
import type { IMAdapter } from "@/core/types";
import { createAgentAdapter } from "@/agents/adapter";
import type { OpenCodeMessageContext } from "@/agents";
import { isStopCommand } from "@/ims/shared/stop-command";
import {
  getChannelSystemMessage,
  getDiscordBotTokens,
  getDiscordTargetChannels,
  getGitHubInfoForUser,
} from "@/config";
import { findReplyThreadIdByStatusMessageTs } from "@/config/local/sessions";
import { isThreadActive, markThreadActive } from "@/config/local/settings";
import { log } from "@/utils";
import { evaluateIncomingMessage, formatIncomingDropMessage } from "@/ims/shared/incoming-pipeline";
import { executeIncomingFlow } from "@/ims/shared/incoming-executor";
import { buildIncomingContext } from "@/ims/shared/incoming-normalizer";
import { parseIncomingCommand } from "@/ims/shared/command-router";
import { createRuntimeController } from "@/ims/shared/runtime-controller";
import {
  toCoreMessageContext,
  type UnifiedMessageContext,
} from "@/ims/shared/message-context";
import {
  DISCORD_LAUNCHER_COMMANDS,
  handleDiscordSettingsInteraction,
  sendLauncherReplyForMessage,
} from "@/ims/discord/settings";

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_THREAD_NAME_LIMIT = 25;
const DISCORD_THREAD_RENAME_LIMIT = 90;

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
  const attempts: string[] = [];
  for (const client of discordClients.values()) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        return channel as any;
      }
      attempts.push(`bot=${client.user?.id || "unknown"}: channel_not_text_or_missing`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      attempts.push(`bot=${client.user?.id || "unknown"}: ${errorMessage}`);
    }
  }

  if (attempts.length > 0) {
    log.warn("Failed to resolve Discord text channel from available clients", {
      channelId,
      clientCount: discordClients.size,
      attempts,
    });
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
  text: string
): Promise<string | undefined> {
  try {
    const channel = await resolveTextChannel(threadId);
    const chunks = splitForDiscord(text);
    let firstId: string | undefined;
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] ?? "";
      try {
        const sent = await channel.send(chunk);
        firstId = firstId || sent.id;
        statusMessageThreadMap.set(sent.id, threadId);
      } catch (error) {
        log.warn("Failed to send Discord message chunk", {
          threadId,
          chunkIndex: index,
          chunkCount: chunks.length,
          chunkLength: chunk.length,
          error: String(error),
        });
        throw error;
      }
    }
    return firstId;
  } catch (error) {
    log.warn("Failed to send Discord message", {
      threadId,
      textLength: text.length,
      error: String(error),
    });
    throw error;
  }
}

async function updateMessage(
  channelId: string,
  messageId: string,
  text: string
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.warn("Failed to update Discord message", {
      messageId,
      channelId,
      resolvedChannelId: statusMessageThreadMap.get(messageId) || findReplyThreadIdByStatusMessageTs(messageId) || channelId,
      error: errorMessage,
      errorStack,
    });
    const normalized = errorMessage.toLowerCase();
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
            const launcherCommand = parseIncomingCommand(text);
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
            const messageContext: UnifiedMessageContext = buildIncomingContext({
              platform: "discord",
              channelId: parentId,
              threadId,
              messageId: message.id,
              userId: message.author.id,
              isTopLevel: false,
              mentionedBot: mentioned,
              activeThread: active,
              rawText: text,
              normalizedText: mentioned ? cleanBotMention(text, client.user.id) : text,
            });
            const flowResult = evaluateIncomingMessage(messageContext, isStopCommand);
            await executeIncomingFlow({
              context: messageContext,
              flowResult,
              markThreadActive,
              handleStopCommand: (channelId, flowThreadId) => coreRuntime.handleStopCommand(channelId, flowThreadId),
              sendStopAck: async () => {
                await message.channel.send("Request stopped.");
              },
              onIgnore: async (reason) => {
                if (reason === "not_mentioned_and_inactive") {
                  log.debug(formatIncomingDropMessage(reason), {
                    platform: "discord",
                    channelId: parentId,
                    threadId,
                    messageId: message.id,
                    isTopLevel: false,
                    mentioned,
                    activeThread: active,
                  });
                  return;
                }
                if (reason === "empty_text" && mentioned) {
                  await message.reply("Please include a request after mentioning me.");
                }
              },
              forwardToCore: async (forwardText) => {
                await coreRuntime.handleIncomingMessage(
                  toCoreMessageContext(messageContext),
                  forwardText
                );
              },
            });
            return;
          }

          const parentId = message.channel.id;
          if (configuredChannels && !configuredChannels.includes(parentId)) return;

          const parentLauncherCommand = parseIncomingCommand(message.content);
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

          const topLevelContext: UnifiedMessageContext = buildIncomingContext({
            platform: "discord",
            channelId: parentId,
            threadId: message.id,
            messageId: message.id,
            userId: message.author.id,
            isTopLevel: true,
            mentionedBot: isBotMentioned(message, client.user.id),
            activeThread: false,
            rawText: message.content,
            normalizedText: cleanBotMention(message.content, client.user.id),
          });
          const topLevelFlow = evaluateIncomingMessage(topLevelContext, isStopCommand, { detectStop: false });
          if (topLevelFlow.type === "ignore" && topLevelFlow.reason === "not_mentioned_and_inactive") {
            log.debug(formatIncomingDropMessage("not_mentioned_and_inactive"), {
              platform: "discord",
              channelId: parentId,
              threadId: message.id,
              messageId: message.id,
              isTopLevel: true,
              mentioned: topLevelContext.mentionedBot,
              activeThread: false,
            });
            return;
          }
          if (topLevelFlow.type === "ignore" && topLevelFlow.reason === "empty_text") {
            await message.reply("Please include a request after mentioning me.");
            return;
          }
          if (topLevelFlow.type !== "forward") return;

          const cleanedLauncherCommand = parseIncomingCommand(topLevelFlow.text);
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

      const thread = await message.startThread({
        name: buildMeaningfulThreadName(topLevelFlow.text),
        autoArchiveDuration: 60,
      });

          markThreadActive(parentId, thread.id);
          await coreRuntime.handleIncomingMessage(
            toCoreMessageContext({
              ...topLevelContext,
              threadId: thread.id,
              replyThreadId: thread.id,
            }),
            topLevelFlow.text
          );
        } catch (error) {
          log.error("Discord message handler failed", { error: String(error) });
        }
      });

      client.on("interactionCreate", async (interaction: any) => {
        try {
          if (await handleDiscordSettingsInteraction(interaction)) return;
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
  }
  return discordRuntimeController.start(reason);
}

export async function stopDiscordRuntime(reason: string): Promise<void> {
  await discordRuntimeController.stop(reason);
}

const discordRuntimeController = createRuntimeController({
  isRunning: () => discordClients.size > 0,
  startInternal: startDiscordRuntimeInternal,
  stopInternal: async (reason: string) => {
    for (const client of discordClients.values()) {
      client.destroy();
    }
    discordClients.clear();
    statusMessageThreadMap.clear();
    log.debug("Discord runtime stopped", { reason });
  },
});

export const recoverPendingRequests = coreRuntime.recoverPendingRequests;
