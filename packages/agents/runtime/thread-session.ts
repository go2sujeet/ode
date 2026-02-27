import {
  getThreadSessionId,
  setThreadSessionId,
} from "@/config/local/sessions";
import type { OpenCodeSessionInfo } from "@/agents/types";
import type { AgentProviderId } from "@/shared/agent-provider";
import { normalizeSessionEnvironment, type SessionEnvironment } from "./base";

type SessionEnvironmentReader = (sessionId: string) => SessionEnvironment | null | undefined;
type SessionEnvironmentWriter = (sessionId: string, env: SessionEnvironment) => void;

export async function getOrCreateThreadSession(params: {
  channelId: string;
  threadId: string;
  providerId: AgentProviderId;
  workingPath: string;
  env: SessionEnvironment;
  createSession: (workingPath: string, env?: SessionEnvironment) => Promise<string>;
  getSessionEnvironment: SessionEnvironmentReader;
  setSessionEnvironment: SessionEnvironmentWriter;
  validateSessionId?: (sessionId: string) => boolean;
  onInvalidSessionId?: (sessionId: string) => void;
  onEnvironmentChanged?: () => void;
  onCreatingSession?: () => void;
}): Promise<OpenCodeSessionInfo> {
  const {
    channelId,
    threadId,
    providerId,
    workingPath,
    env,
    createSession,
    getSessionEnvironment,
    setSessionEnvironment,
    validateSessionId,
    onInvalidSessionId,
    onEnvironmentChanged,
    onCreatingSession,
  } = params;

  const existingSession = getThreadSessionId(channelId, threadId, providerId);
  if (existingSession) {
    if (validateSessionId && !validateSessionId(existingSession)) {
      onInvalidSessionId?.(existingSession);
      const sessionId = await createSession(workingPath, env);
      setThreadSessionId(channelId, threadId, sessionId);
      return { sessionId, created: true };
    }

    const existingEnv = normalizeSessionEnvironment(getSessionEnvironment(existingSession));
    const desiredEnv = normalizeSessionEnvironment(env);
    if (existingEnv !== desiredEnv) {
      onEnvironmentChanged?.();
      const sessionId = await createSession(workingPath, env);
      setThreadSessionId(channelId, threadId, sessionId);
      return { sessionId, created: true };
    }

    setSessionEnvironment(existingSession, env);
    return { sessionId: existingSession, created: false };
  }

  onCreatingSession?.();
  const sessionId = await createSession(workingPath, env);
  setThreadSessionId(channelId, threadId, sessionId);
  return { sessionId, created: true };
}
