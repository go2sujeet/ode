import { describe, expect, it } from "bun:test";
import type { IMAdapter } from "@/core/types";

export function runImAdapterContractSuite(name: string, makeAdapter: () => IMAdapter): void {
  describe(`IMAdapter contract: ${name}`, () => {
    it("exposes required functions", () => {
      const adapter = makeAdapter();
      expect(typeof adapter.sendMessage).toBe("function");
      expect(typeof adapter.updateMessage).toBe("function");
      expect(typeof adapter.deleteMessage).toBe("function");
      expect(typeof adapter.fetchThreadHistory).toBe("function");
      expect(typeof adapter.buildAgentContext).toBe("function");
    });
  });
}
