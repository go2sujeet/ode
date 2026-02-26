import { describe, expect, it } from "bun:test";
import { createProcessorManager } from "./processor-manager";

describe("processor manager", () => {
  it("uses default processor id when missing", () => {
    const seen: string[] = [];
    const manager = createProcessorManager({
      defaultProcessorId: "p:default",
      createRuntime: (processorId) => {
        seen.push(processorId);
        return { processorId };
      },
    });

    const first = manager.getRuntime();
    const second = manager.getRuntime("p:default");

    expect(first).toBe(second);
    expect(seen).toEqual(["p:default"]);
  });
});
