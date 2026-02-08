---
name: kiro-cli-skill
description: Reference guide for integrating and operating Kiro CLI in Ode, focused on non-interactive chat sessions, trust flags, session management, and diagnostics.
---
## What I do
- Summarize Kiro CLI command surface for agent integrations.
- Recommend automation-safe invocation patterns for `kiro-cli chat`.
- Document session lifecycle (`--resume`, session listing/deletion) and troubleshooting commands.
- Highlight auth, MCP, and logging commands relevant to debugging provider issues.

## When to use me
Use this when implementing or debugging the `kiro` provider in Ode, especially CLI command construction, session behavior, and non-interactive scripting.

## Recommended invocation pattern for Ode
- Base command: `kiro-cli chat --no-interactive --trust-all-tools [--resume] [--agent <agent>] <prompt>`
- Use `--resume` for follow-up turns in the same project directory.
- Use `--no-interactive` in automation to print the first response to stdout and exit.
- Prefer explicit `kiro-cli` binary; optionally fall back to `kiro` alias if installed.

## Key CLI references
- Global flags: `--verbose`, `--agent`, `--help`, `--version`, `--help-all`.
- Session management: `kiro-cli chat --resume`, `--resume-picker`, `--list-sessions`, `--delete-session <ID>`.
- Auth: `kiro-cli login`, `kiro-cli logout`, `kiro-cli whoami`.
- Health checks: `kiro-cli doctor`, `kiro-cli diagnostic`.
- Config management: `kiro-cli settings list`, `kiro-cli settings <key> <value>`, `kiro-cli settings --delete <key>`.
- MCP tooling: `kiro-cli mcp add|remove|list|import|status`.

## Integration notes for Ode
- Kiro does not require channel-level model selection in Ode config.
- Keep model picker hidden/disabled when provider is `kiro`.
- Preserve one Ode session per Slack thread, while Kiro conversation resume remains directory-scoped.
- For live status, emit normalized session/text update events even if the CLI output is plain text.

## Logging and diagnostics
- Kiro logs are in `$XDG_RUNTIME_DIR/kiro-log` (Linux fallback: `/tmp/kiro-log/`).
- Set `KIRO_LOG_LEVEL` to `error|warn|info|debug|trace` for troubleshooting.

## Source
- https://kiro.dev/docs/cli/reference/cli-commands/
