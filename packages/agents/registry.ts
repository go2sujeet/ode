import * as claude from "./claude";
import * as codex from "./codex";
import * as opencode from "./opencode";
import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "./types";

export type AgentProviderId = "opencode" | "claudecode" | "codex";

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
  },
};

export function getSelectedAgentProviderId(): AgentProviderId {
  const raw = process.env.ODE_AGENT_PROVIDER?.trim().toLowerCase();
  if (raw === "claudecode" || raw === "claude") return "claudecode";
  if (raw === "codex") return "codex";
  return "opencode";
}

export function getSelectedAgentProvider(): AgentProvider {
  return providers[getSelectedAgentProviderId()];
}

export function getAgentProvider(providerId: AgentProviderId): AgentProvider {
  return providers[providerId];
}
