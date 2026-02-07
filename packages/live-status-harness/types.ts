import type { AgentProviderId } from "@/agents/registry";

export type HarnessProvider = AgentProviderId;

export type HarnessRunMeta = {
  runId: string;
  provider: HarnessProvider;
  prompt: string;
  promptHash: string;
  cwd: string;
  channelId: string;
  threadId: string;
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  finalText?: string;
  eventCount: number;
};

export type HarnessCapturedEvent = {
  runId: string;
  sessionId: string;
  provider: HarnessProvider;
  timestamp: number;
  index: number;
  event: unknown;
};

export type HarnessRenderedStatus = {
  index: number;
  timestamp: number;
  text: string;
};
