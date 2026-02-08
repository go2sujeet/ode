---
name: qwen-code-skill
description: Reference guide for integrating and operating Qwen Code CLI in Ode, focused on headless mode, stream-json events, and session resume behavior.
---
## What I do
- Summarize Qwen Code headless invocation for Ode agent integrations.
- Document non-interactive command patterns for `stream-json` output.
- Explain session continuation (`--continue`, `--resume`) and project-scoped chat state.
- Highlight automation-safe defaults for CI scripts and long-running workflows.

## When to use me
Use this when adding or debugging Ode's `qwen` provider, especially command construction, parsing streamed JSON events, and live status compatibility.

## Recommended invocation pattern
- Base command: `qwen --output-format stream-json --include-partial-messages --yolo -p <prompt>`
- Resume existing context: append `--resume <sessionId>` (or `--continue` for latest project session)
- Text-only one-shot output: omit `--output-format` and use default text mode

## Integration notes for Ode
- Qwen headless supports `text`, `json`, and `stream-json`; use `stream-json` for live status updates.
- `--include-partial-messages` emits incremental events (for example `content_block_delta`) that map well to status rendering.
- Session history is project-scoped under `~/.qwen/projects/<sanitized-cwd>/chats`; restoring a session recovers history and tool context.
- Keep channel model selection disabled for Qwen in Ode UI; provider logic does not require per-channel model overrides.

## Sources
- https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/
