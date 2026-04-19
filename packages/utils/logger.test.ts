import { describe, expect, it } from "bun:test";

describe("logger EPIPE guard", () => {
  it("installs an error listener on stdout and stderr that swallows EPIPE", async () => {
    // Importing the module registers the guard as a side effect.
    await import("./logger");

    const stdoutListeners = process.stdout.listeners("error");
    const stderrListeners = process.stderr.listeners("error");
    expect(stdoutListeners.length).toBeGreaterThanOrEqual(1);
    expect(stderrListeners.length).toBeGreaterThanOrEqual(1);

    // Emitting EPIPE on stdout must not throw (reproduces ODE-DEAMON-6).
    const epipe = Object.assign(new Error("EPIPE: broken pipe, write"), {
      code: "EPIPE",
    });
    expect(() => process.stdout.emit("error", epipe)).not.toThrow();
    expect(() => process.stderr.emit("error", epipe)).not.toThrow();
  });
});
