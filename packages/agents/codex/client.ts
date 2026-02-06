import type {
  OpenCodeMessage,
  OpenCodeMessageContext,
  OpenCodeOptions,
  OpenCodeSessionInfo,
} from "../types";

export type SessionEnvironment = Record<string, string>;

function notImplemented(method: string): never {
  throw new Error(`Codex provider not implemented: ${method}`);
}

export async function createSession(_workingPath: string, _env?: SessionEnvironment): Promise<string> {
  return notImplemented("createSession");
}

export async function getOrCreateSession(
  _channelId: string,
  _threadId: string,
  _workingPath: string,
  _env: SessionEnvironment = {}
): Promise<OpenCodeSessionInfo> {
  return notImplemented("getOrCreateSession");
}

export async function sendMessage(
  _channelId: string,
  _sessionId: string,
  _message: string,
  _workingPath: string,
  _options?: OpenCodeOptions,
  _context?: OpenCodeMessageContext
): Promise<OpenCodeMessage[]> {
  return notImplemented("sendMessage");
}

export async function ensureSession(_sessionId: string): Promise<void> {
  return notImplemented("ensureSession");
}

export function subscribeToSession(_sessionId: string, _handler: (event: unknown) => void): () => void {
  notImplemented("subscribeToSession");
}

export async function abortSession(_sessionId: string, _directory?: string): Promise<void> {
  return notImplemented("abortSession");
}

export async function cancelActiveRequest(
  _channelId: string,
  _sessionId: string,
  _directory?: string
): Promise<boolean> {
  return notImplemented("cancelActiveRequest");
}

export function stopServer(): void {
  notImplemented("stopServer");
}

export async function startServer(): Promise<void> {
  return notImplemented("startServer");
}
