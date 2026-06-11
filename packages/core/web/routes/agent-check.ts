import type { Elysia } from "elysia";
import { log } from "@/utils";
import { isAgentProviderId } from "@/shared/agent-provider";
import { runAgentCheck, runSingleAgentCheck, type AgentCheckProviderResult } from "../agent-check";
import { jsonResponse } from "../http";

function logAgentCheckModelErrors(result: AgentCheckProviderResult): void {
  if (result.opencodeModelError) {
    log.warn("Failed to query OpenCode models during agent check", {
      error: result.opencodeModelError,
    });
  }
  if (result.kiloModelError) {
    log.warn("Failed to query Kilo models during agent check", {
      error: result.kiloModelError,
    });
  }
  if (result.piModelError) {
    log.warn("Failed to query Pi models during agent check", {
      error: result.piModelError,
    });
  }
  if (result.openhandsModelError) {
    log.warn("Failed to query OpenHands models during agent check", {
      error: result.openhandsModelError,
    });
  }
  if (result.codebuddyModelError) {
    log.warn("Failed to query CodeBuddy models during agent check", {
      error: result.codebuddyModelError,
    });
  }
  if (result.crushModelError) {
    log.warn("Failed to query Crush models during agent check", {
      error: result.crushModelError,
    });
  }
}

export function registerAgentCheckRoutes(app: Elysia): void {
  app.get("/api/agent-check", async () => {
    const result = await runAgentCheck();
    logAgentCheckModelErrors(result);
    return jsonResponse(200, {
      ok: true,
      result,
    });
  });

  app.get("/api/agent-check/:provider", async ({ params }) => {
    const provider = params.provider;
    if (!isAgentProviderId(provider)) {
      return jsonResponse(400, {
        ok: false,
        error: "Unknown agent provider",
      });
    }

    const result = await runSingleAgentCheck(provider);
    logAgentCheckModelErrors(result);
    return jsonResponse(200, {
      ok: true,
      result,
    });
  });
}
