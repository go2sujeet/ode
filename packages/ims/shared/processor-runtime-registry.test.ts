import { describe, expect, it } from "bun:test";
import { createProcessorRuntimeRegistry } from "./processor-runtime-registry";

describe("processor runtime registry", () => {
  it("reuses runtime for same processor id", () => {
    let created = 0;
    const registry = createProcessorRuntimeRegistry((id) => {
      created += 1;
      return { id, order: created };
    });

    const a1 = registry.get("p1");
    const a2 = registry.get("p1");
    const b = registry.get("p2");

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(registry.size()).toBe(2);
  });

  it("creates fresh runtime after clear", () => {
    let created = 0;
    const registry = createProcessorRuntimeRegistry((id) => ({ id, n: ++created }));

    const before = registry.get("p1");
    registry.clear();
    const after = registry.get("p1");

    expect(before).not.toBe(after);
    expect(registry.size()).toBe(1);
  });
});
