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

  it("returns provider metadata", () => {
    const opencode = getAgentProvider("opencode");
    const claudecode = getAgentProvider("claudecode");
    expect(opencode.supportsEventStream).toBe(true);
    expect(claudecode.supportsEventStream).toBe(false);
  });
});
