import type { StatusMessageFormat } from "@/config/status-message-format";
import type { AgentAdapter, StatusMessageRequest } from "@/core/types";
import { buildStatusMessageByProvider } from "@/utils/status";
import type { SessionMessageState } from "@/utils/session-inspector";

export function buildStatusMessageForAgent(params: {
  agent: AgentAdapter;
  request: StatusMessageRequest;
  workingPath: string;
  state?: SessionMessageState;
  statusMessageFormat: StatusMessageFormat;
}): string {
  const { agent, request, workingPath, state, statusMessageFormat } = params;
  const provider = agent.getProviderForSession(request.sessionId);
  return buildStatusMessageByProvider(provider, request, workingPath, state, statusMessageFormat);
}
