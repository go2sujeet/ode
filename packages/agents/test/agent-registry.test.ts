import { afterEach, describe, expect, it } from "bun:test";
import { getAgentProvider, getSelectedAgentProviderId } from "../registry";

describe("agent registry", () => {
  const original = process.env.ODE_AGENT_PROVIDER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.ODE_AGENT_PROVIDER;
    } else {
      process.env.ODE_AGENT_PROVIDER = original;
    }
  });

  it("defaults to opencode", () => {
    delete process.env.ODE_AGENT_PROVIDER;
    expect(getSelectedAgentProviderId()).toBe("opencode");
  });

  it("selects claudecode from env", () => {
    process.env.ODE_AGENT_PROVIDER = "claude";
    expect(getSelectedAgentProviderId()).toBe("claudecode");
  });

  it("selects kimi from env", () => {
    process.env.ODE_AGENT_PROVIDER = "kimi";
    expect(getSelectedAgentProviderId()).toBe("kimi");
  });

  it("selects kiro from env", () => {
    process.env.ODE_AGENT_PROVIDER = "kiro";
    expect(getSelectedAgentProviderId()).toBe("kiro");
  });

  it("selects qwen from env", () => {
    process.env.ODE_AGENT_PROVIDER = "qwen";
    expect(getSelectedAgentProviderId()).toBe("qwen");
  });

  it("returns provider metadata", () => {
    const opencode = getAgentProvider("opencode");
    const claudecode = getAgentProvider("claudecode");
    const kimi = getAgentProvider("kimi");
    const kiro = getAgentProvider("kiro");
    const qwen = getAgentProvider("qwen");
    expect(opencode.supportsEventStream).toBe(true);
    expect(claudecode.supportsEventStream).toBe(false);
    expect(kimi.supportsEventStream).toBe(false);
    expect(kiro.supportsEventStream).toBe(false);
    expect(qwen.supportsEventStream).toBe(false);
  });
});
