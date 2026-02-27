import { describe, expect, it } from "bun:test";
import { LarkRuntimeState } from "@/ims/lark/state/runtime-state";

describe("LarkRuntimeState", () => {
  it("tracks token, bot id, thread map, and edit counts", () => {
    const state = new LarkRuntimeState();

    state.setTenantToken("W1", { token: "tok", expiresAt: 1 });
    state.setBotOpenId("W1", "ou_x");
    state.setMessageThread("m1", { channelId: "c1", threadId: "t1" });
    state.setMessageEditCount("m1", 2);

    expect(state.getTenantToken("W1")?.token).toBe("tok");
    expect(state.getBotOpenId("W1")).toBe("ou_x");
    expect(state.getMessageThread("m1")?.threadId).toBe("t1");
    expect(state.getMessageEditCount("m1")).toBe(2);

    state.moveMessageEditCount("m1", "m2");
    expect(state.getMessageEditCount("m1")).toBe(0);
    expect(state.getMessageEditCount("m2")).toBe(0);

    state.clear();
    expect(state.getTenantToken("W1")).toBeUndefined();
    expect(state.getBotOpenId("W1")).toBeUndefined();
    expect(state.getMessageThread("m1")).toBeUndefined();
  });
});
