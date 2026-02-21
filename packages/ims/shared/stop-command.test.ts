import { describe, expect, it } from "bun:test";
import { isStopCommand } from "./stop-command";

describe("isStopCommand", () => {
  it("matches only exact stop command", () => {
    expect(isStopCommand("stop")).toBe(true);
    expect(isStopCommand(" STOP ")).toBe(true);

    expect(isStopCommand("stpp")).toBe(false);
    expect(isStopCommand("please stop this")).toBe(false);
    expect(isStopCommand("stop!")).toBe(false);
    expect(isStopCommand("stopped")).toBe(false);
  });
});
