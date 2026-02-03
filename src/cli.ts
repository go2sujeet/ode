#!/usr/bin/env bun

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  // Keep this minimal; runtime.ts already handles --local/--cloud parsing.
  console.log(
    [
      "ode - OpenCode Slack bot",
      "",
      "Usage:",
      "  ode [--local|--cloud]",
      "",
      "Examples:",
      "  ode --local",
      "  ode --cloud",
    ].join("\n")
  );
  process.exit(0);
}

await import("./index");
