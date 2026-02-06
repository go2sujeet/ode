import type { MessageFrequency } from "@/config/message-frequency";
import type { AgentAdapter, StatusMessageRequest } from "@/core/types";
import { buildLiveStatusMessage } from "@/utils/status";
import type { SessionMessageState } from "@/utils/session-inspector";

export function buildStatusMessageForAgent(params: {
  agent: AgentAdapter;
  request: StatusMessageRequest;
  workingPath: string;
  state?: SessionMessageState;
  frequency: MessageFrequency;
}): string {
  const { agent, request, workingPath, state, frequency } = params;
  if (agent.buildStatusMessage) {
    return agent.buildStatusMessage({
      request,
      workingPath,
      state,
      frequency,
    });
  }

  return buildLiveStatusMessage(request, workingPath, state, frequency);
}
