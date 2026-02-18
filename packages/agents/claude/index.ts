export {
  createSession,
  getOrCreateSession,
  sendMessage,
  cancelActiveRequest,
  abortSession,
  ensureSession,
  subscribeToSession,
  startServer,
  stopServer,
  type SessionEnvironment,
} from "./client";

export function getStaticConfig(): { displayName: string } {
  return { displayName: "Claude Code" };
}
