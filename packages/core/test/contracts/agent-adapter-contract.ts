import { describe, expect, it } from "bun:test";
import type { AgentAdapter } from "@/core/types";

export function runAgentAdapterContractSuite(name: string, makeAdapter: () => AgentAdapter): void {
  describe(`AgentAdapter contract: ${name}`, () => {
    it("exposes required functions", () => {
      const adapter = makeAdapter();
      expect(typeof adapter.getOrCreateSession).toBe("function");
      expect(typeof adapter.sendMessage).toBe("function");
      expect(typeof adapter.abortSession).toBe("function");
      expect(typeof adapter.ensureSession).toBe("function");
      expect(typeof adapter.subscribeToSession).toBe("function");
      expect(typeof adapter.replyToQuestion).toBe("function");
      expect(typeof adapter.normalizeQuestions).toBe("function");
      expect(typeof adapter.supportsEventStream).toBe("boolean");
    });
  });
}
