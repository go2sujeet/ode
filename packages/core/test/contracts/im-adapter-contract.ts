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

    it("supports send/update/delete and context building", async () => {
      const adapter = makeAdapter();
      const messageTs = await adapter.sendMessage("C1", "T1", "hello");
      if (messageTs) {
        await adapter.updateMessage("C1", messageTs, "updated");
        await adapter.deleteMessage("C1", messageTs);
      }

      const context = await adapter.buildAgentContext({
        cwd: "/tmp",
        channelId: "C1",
        replyThreadId: "T1",
        threadId: "T1",
        userId: "U1",
        threadHistory: "U1: hello",
      });
      expect(typeof context).toBe("object");
    });
  });
}
