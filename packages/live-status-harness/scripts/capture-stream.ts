import { createHash } from "node:crypto";
import type { OpenCodeMessageContext } from "@/agents";
import { getAgentProvider, type AgentProviderId } from "@/agents/registry";
import type { OpenCodeOptions } from "@/agents/types";
import { buildHarnessRunId, HarnessRedisStore } from "../redis-store";
import type { HarnessCapturedEvent, HarnessRunMeta } from "../types";

const DEFAULT_CHANNEL_ID = "C_LIVE_STATUS_HARNESS";
const DEFAULT_USER_ID = "U_LIVE_STATUS_HARNESS";

function parseArg(name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `--${name}=`;
  const index = Bun.argv.findIndex((value) => value === exact || value.startsWith(prefix));
  if (index < 0) return undefined;
  const value = Bun.argv[index] ?? "";
  if (value.startsWith(prefix)) return value.slice(prefix.length);
  return Bun.argv[index + 1];
}

function normalizeProvider(value: string | undefined): AgentProviderId {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "claude") return "claudecode";
  if (normalized === "claudecode" || normalized === "codex" || normalized === "kimi") {
    return normalized;
  }
  return "opencode";
}

function parseModelArg(value: string | undefined): OpenCodeOptions["model"] | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const [providerRaw, modelRaw] = normalized.includes("/")
    ? normalized.split("/", 2)
    : ["openai", normalized];
  const providerID = providerRaw?.trim().toLowerCase().replace(/\s+/g, "-") ?? "openai";
  const modelID = modelRaw?.trim() ?? "";
  if (!modelID) {
    throw new Error("Invalid --model value; use <provider>/<model> or <model>");
  }
  return { providerID, modelID };
}

async function loadPrompt(promptPath?: string): Promise<string> {
  const defaultPath = new URL("../fixed-prompt.md", import.meta.url);
  const file = promptPath ? Bun.file(promptPath) : Bun.file(defaultPath);
  const text = (await file.text()).trim();
  if (!text) throw new Error("Prompt text is empty");
  return text;
}

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

async function main(): Promise<void> {
  const provider = normalizeProvider(parseArg("provider") || process.env.ODE_AGENT_PROVIDER);
  const cwd = parseArg("cwd") || process.cwd();
  const channelId = parseArg("channel") || DEFAULT_CHANNEL_ID;
  const threadId = parseArg("thread") || `T_${Date.now()}`;
  const userId = parseArg("user") || DEFAULT_USER_ID;
  const prompt = await loadPrompt(parseArg("prompt-file"));
  const model = parseModelArg(parseArg("model"));

  const runId = parseArg("run-id") || buildHarnessRunId(provider);
  const startedAt = Date.now();
  const promptHash = hashPrompt(prompt);
  const redisPrefix = parseArg("redis-prefix");
  const store = new HarnessRedisStore(redisPrefix);
  await store.connect();

  const providerClient = getAgentProvider(provider);
  const session = await providerClient.getOrCreateSession(channelId, threadId, cwd, {});
  let eventCount = 0;
  const pendingWrites: Array<Promise<void>> = [];

  const runMeta: HarnessRunMeta = {
    runId,
    provider,
    prompt,
    promptHash,
    cwd,
    channelId,
    threadId,
    sessionId: session.sessionId,
    startedAt,
    eventCount,
  };
  await store.saveRunMeta(runMeta);

  const unsubscribe = providerClient.subscribeToSession(session.sessionId, (event) => {
    const captured: HarnessCapturedEvent = {
      runId,
      sessionId: session.sessionId,
      provider,
      timestamp: Date.now(),
      index: eventCount,
      event,
    };
    eventCount += 1;
    pendingWrites.push(store.appendEvent(captured));
  });

  try {
    const context: OpenCodeMessageContext = {
      slack: {
        channelId,
        threadId,
        userId,
        hasCustomSlackTool: false,
        odeSlackApiUrl: process.env.ODE_SLACK_API_URL,
        hasGitHubToken: Boolean(process.env.GH_TOKEN),
      },
    };

    const responses = await providerClient.sendMessage(
      channelId,
      session.sessionId,
      prompt,
      cwd,
      model ? { model } : undefined,
      context
    );

    await Promise.all(pendingWrites);

    const finalText = responses
      .map((response) => response.text)
      .filter((text) => text.trim().length > 0)
      .join("\n\n");

    await store.updateRunMeta(runId, {
      completedAt: Date.now(),
      eventCount,
      finalText,
    });

    process.stdout.write(`${JSON.stringify({ runId, provider, sessionId: session.sessionId, eventCount })}\n`);
  } finally {
    unsubscribe();
    await Promise.allSettled(pendingWrites);
    await store.close();
  }
}

await main();
