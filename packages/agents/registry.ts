import * as claude from "./claude";
import * as codex from "./codex";
import * as kimi from "./kimi";
import * as kiro from "./kiro";
import * as kilo from "./kilo";
import * as opencode from "./opencode";
import * as qwen from "./qwen";
import * as goose from "./goose";
import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "./types";

export type AgentProviderId = "opencode" | "claudecode" | "codex" | "kimi" | "kiro" | "kilo" | "qwen" | "goose";

export type AgentStaticConfig = {
  displayName: string;
};

export type AgentProvider = {
  id: AgentProviderId;
  supportsEventStream: boolean;
  startServer: () => Promise<void>;
  stopServer: () => void | Promise<void>;
  createSession: (workingPath: string, env?: Record<string, string>) => Promise<string>;
  getOrCreateSession: (
    channelId: string,
    threadId: string,
    workingPath: string,
    env?: Record<string, string>
  ) => Promise<OpenCodeSessionInfo>;
  sendMessage: (
    channelId: string,
    sessionId: string,
    message: string,
    workingPath: string,
    options?: OpenCodeOptions,
    context?: OpenCodeMessageContext
  ) => Promise<OpenCodeMessage[]>;
  abortSession: (sessionId: string, directory?: string) => Promise<void>;
  cancelActiveRequest: (channelId: string, sessionId: string, directory?: string) => Promise<boolean>;
  ensureSession: (sessionId: string) => Promise<void>;
  subscribeToSession: (sessionId: string, handler: (event: unknown) => void) => () => void;
  getStaticConfig: () => AgentStaticConfig;
};

const providers: Record<AgentProviderId, AgentProvider> = {
  opencode: {
    id: "opencode",
    supportsEventStream: true,
    startServer: opencode.startServer,
    stopServer: opencode.stopServer,
    createSession: opencode.createSession,
    getOrCreateSession: opencode.getOrCreateSession,
    sendMessage: opencode.sendMessage,
    abortSession: opencode.abortSession,
    cancelActiveRequest: opencode.cancelActiveRequest,
    ensureSession: opencode.ensureSession,
    subscribeToSession: opencode.subscribeToSession,
    getStaticConfig: opencode.getStaticConfig,
  },
  claudecode: {
    id: "claudecode",
    supportsEventStream: false,
    startServer: claude.startServer,
    stopServer: claude.stopServer,
    createSession: claude.createSession,
    getOrCreateSession: claude.getOrCreateSession,
    sendMessage: claude.sendMessage,
    abortSession: claude.abortSession,
    cancelActiveRequest: claude.cancelActiveRequest,
    ensureSession: claude.ensureSession,
    subscribeToSession: claude.subscribeToSession,
    getStaticConfig: claude.getStaticConfig,
  },
  codex: {
    id: "codex",
    supportsEventStream: false,
    startServer: codex.startServer,
    stopServer: codex.stopServer,
    createSession: codex.createSession,
    getOrCreateSession: codex.getOrCreateSession,
    sendMessage: codex.sendMessage,
    abortSession: codex.abortSession,
    cancelActiveRequest: codex.cancelActiveRequest,
    ensureSession: codex.ensureSession,
    subscribeToSession: codex.subscribeToSession,
    getStaticConfig: codex.getStaticConfig,
  },
  kimi: {
    id: "kimi",
    supportsEventStream: false,
    startServer: kimi.startServer,
    stopServer: kimi.stopServer,
    createSession: kimi.createSession,
    getOrCreateSession: kimi.getOrCreateSession,
    sendMessage: kimi.sendMessage,
    abortSession: kimi.abortSession,
    cancelActiveRequest: kimi.cancelActiveRequest,
    ensureSession: kimi.ensureSession,
    subscribeToSession: kimi.subscribeToSession,
    getStaticConfig: kimi.getStaticConfig,
  },
  kiro: {
    id: "kiro",
    supportsEventStream: false,
    startServer: kiro.startServer,
    stopServer: kiro.stopServer,
    createSession: kiro.createSession,
    getOrCreateSession: kiro.getOrCreateSession,
    sendMessage: kiro.sendMessage,
    abortSession: kiro.abortSession,
    cancelActiveRequest: kiro.cancelActiveRequest,
    ensureSession: kiro.ensureSession,
    subscribeToSession: kiro.subscribeToSession,
    getStaticConfig: kiro.getStaticConfig,
  },
  kilo: {
    id: "kilo",
    supportsEventStream: false,
    startServer: kilo.startServer,
    stopServer: kilo.stopServer,
    createSession: kilo.createSession,
    getOrCreateSession: kilo.getOrCreateSession,
    sendMessage: kilo.sendMessage,
    abortSession: kilo.abortSession,
    cancelActiveRequest: kilo.cancelActiveRequest,
    ensureSession: kilo.ensureSession,
    subscribeToSession: kilo.subscribeToSession,
    getStaticConfig: kilo.getStaticConfig,
  },
  qwen: {
    id: "qwen",
    supportsEventStream: false,
    startServer: qwen.startServer,
    stopServer: qwen.stopServer,
    createSession: qwen.createSession,
    getOrCreateSession: qwen.getOrCreateSession,
    sendMessage: qwen.sendMessage,
    abortSession: qwen.abortSession,
    cancelActiveRequest: qwen.cancelActiveRequest,
    ensureSession: qwen.ensureSession,
    subscribeToSession: qwen.subscribeToSession,
    getStaticConfig: qwen.getStaticConfig,
  },
  goose: {
    id: "goose",
    supportsEventStream: false,
    startServer: goose.startServer,
    stopServer: goose.stopServer,
    createSession: goose.createSession,
    getOrCreateSession: goose.getOrCreateSession,
    sendMessage: goose.sendMessage,
    abortSession: goose.abortSession,
    cancelActiveRequest: goose.cancelActiveRequest,
    ensureSession: goose.ensureSession,
    subscribeToSession: goose.subscribeToSession,
    getStaticConfig: goose.getStaticConfig,
  },
};

export function getSelectedAgentProviderId(): AgentProviderId {
  const raw = process.env.ODE_AGENT_PROVIDER?.trim().toLowerCase();
  if (raw === "claudecode" || raw === "claude") return "claudecode";
  if (raw === "codex") return "codex";
  if (raw === "kimi") return "kimi";
  if (raw === "kiro") return "kiro";
  if (raw === "kilo") return "kilo";
  if (raw === "qwen") return "qwen";
  if (raw === "goose") return "goose";
  return "opencode";
}

export function getSelectedAgentProvider(): AgentProvider {
  return providers[getSelectedAgentProviderId()];
}

export function getAgentProvider(providerId: AgentProviderId): AgentProvider {
  return providers[providerId];
}
