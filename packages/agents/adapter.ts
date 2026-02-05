import type { AgentAdapter } from "@ode/core/types";
import {
  getOrCreateSession,
  sendMessage,
  abortSession,
  ensureSession,
  subscribeToSession,
  supportsEventStream,
} from "./index";
import { getSessionClient } from "./opencode";

export function createAgentAdapter(): AgentAdapter {
  return {
    supportsEventStream,
    getOrCreateSession,
    sendMessage,
    abortSession,
    ensureSession,
    subscribeToSession,
    async replyToQuestion({ requestId, sessionId, directory, answers }) {
      const client = await getSessionClient(sessionId);
      const response = await client.question.reply({
        requestID: requestId,
        directory,
        answers,
      });
      if (response.error) {
        throw new Error(`OpenCode question reply error: ${response.error}`);
      }
    },
  };
}
