import { describe, expect, it } from "bun:test";
import { RuntimeCache } from "@/shared/cache/runtime-cache";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("RuntimeCache", () => {
  it("loads once with getOrSet", async () => {
    const cache = new RuntimeCache<string, { value: string }>({ max: 10, ttlMs: 1000 });
    let calls = 0;
    const first = await cache.getOrSet("k1", async () => {
      calls += 1;
      return { value: "v1" };
    });
    const second = await cache.getOrSet("k1", async () => {
      calls += 1;
      return { value: "v2" };
    });

    expect(first.value).toBe("v1");
    expect(second.value).toBe("v1");
    expect(calls).toBe(1);
  });

  it("expires by ttl", async () => {
    const cache = new RuntimeCache<string, { value: string }>({ max: 10, ttlMs: 5 });
    cache.set("k", { value: "v" });
    expect(cache.get("k")?.value).toBe("v");
    await sleep(10);
    expect(cache.get("k")).toBeUndefined();
  });
});
