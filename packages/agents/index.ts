import { getAgentProvider, getSelectedAgentProvider } from "./registry";

export type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeProgressHandler,
  OpenCodeSessionInfo,
} from "./types";

const agent = getSelectedAgentProvider();
const opencodeProvider = getAgentProvider("opencode");
const claudeProvider = getAgentProvider("claude");

export const selectedAgent = agent.id;
export const supportsEventStream = agent.supportsEventStream;

export const startServer = agent.startServer;
export const stopServer = agent.stopServer;
export const createSession = agent.createSession;
export const getOrCreateSession = agent.getOrCreateSession;
export const sendMessage = agent.sendMessage;
export const abortSession = agent.abortSession;
export const cancelActiveRequest = agent.cancelActiveRequest;
export const ensureSession = agent.ensureSession;
export const subscribeToSession = agent.subscribeToSession;

export async function stopAllServers(): Promise<void> {
  await Promise.allSettled([
    Promise.resolve(opencodeProvider.stopServer()),
    Promise.resolve(claudeProvider.stopServer()),
  ]);
}
