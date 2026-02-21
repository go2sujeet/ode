import { getAgentProvider, getSelectedAgentProvider } from "./registry";

export type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "./types";

const agent = getSelectedAgentProvider();
const opencodeProvider = getAgentProvider("opencode");
const claudeProvider = getAgentProvider("claudecode");
const codexProvider = getAgentProvider("codex");
const kimiProvider = getAgentProvider("kimi");
const kiroProvider = getAgentProvider("kiro");
const kiloProvider = getAgentProvider("kilo");
const qwenProvider = getAgentProvider("qwen");
const gooseProvider = getAgentProvider("goose");
const geminiProvider = getAgentProvider("gemini");

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
    Promise.resolve().then(() => opencodeProvider.stopServer()),
    Promise.resolve().then(() => claudeProvider.stopServer()),
    Promise.resolve().then(() => codexProvider.stopServer()),
    Promise.resolve().then(() => kimiProvider.stopServer()),
    Promise.resolve().then(() => kiroProvider.stopServer()),
    Promise.resolve().then(() => kiloProvider.stopServer()),
    Promise.resolve().then(() => qwenProvider.stopServer()),
    Promise.resolve().then(() => gooseProvider.stopServer()),
    Promise.resolve().then(() => geminiProvider.stopServer()),
  ]);
}
