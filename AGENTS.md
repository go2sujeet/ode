# Ode - Agent Notes

Ode is a Slack bot that bridges messages to OpenCode for AI-assisted coding.

## Architecture
- Entry: `src/index.ts`
- Config: `src/config/` (Zod env validation)
- Slack: `src/slack/` (Bolt app, commands, OAuth, formatting)
- OpenCode: `src/agents/opencode/` (SDK client)
- Storage: `src/storage/` (settings, sessions, active requests)

## Runtime behavior
- SDK event loop handles permission auto-approval
- Per-channel agents stored in `~/.config/ode/agents/{channelId}.md`
- Settings: `~/.config/ode/settings.json`
- Sessions: `~/.config/ode/sessions/`
- Bot replies in threads once mentioned
- Status updates include phases, tool progress, and elapsed time
- Status messages are preserved as an operation record
- When capturing screenshots, save images to the system temp folder and upload them to Slack as soon as possible
- When merging PRs, do not delete the branch if the current worktree is on that branch

## Commands
- Dev: `bun run dev`
- Prod: `./start.sh`
- User: `@ode <message>` and `stop`

## One-time Tasks (`ode task`)
- A Task is a one-shot scheduled prompt: the scheduler fires it exactly once at an absolute time, then posts the agent result back to the channel (or thread, if anchored).
- CLI:
  - `ode task create --time <ISO8601> --channel <channelId> --message "<prompt>" [--thread <threadId>] [--title <title>] [--agent <agentId>] [--run-now]`
  - `ode task list [--status pending|running|success|failed|cancelled] [--json]`
  - `ode task show <id>` / `ode task cancel <id>` / `ode task delete <id>` / `ode task run <id>`
- When `--thread` is set, the scheduler reuses the existing thread's session so the agent wakes up with full context. When `--thread` is omitted, the task posts as a new channel message under a synthetic thread (`task:{id}`).
- Agents should prefer scheduling a Task instead of blocking on long waits (deploys, overnight builds, approvals): schedule the follow-up and return.
- Persistence: SQLite at `~/.config/ode/inbox.db` (table `tasks`); scheduler polls every 10s and uses `UPDATE ... WHERE status='pending'` for cross-process idempotency.
- HTTP API mirrors the CLI under `/api/tasks*`; the Web UI lives at Settings → Tasks.

## Bun conventions
- Use Bun instead of Node.js
- Run: `bun run src/index.ts`
- Tests: `bun test`
- Prefer `Bun.file` over `node:fs`

## Skills
- Available skills: `agent-browser`, `slack-developer-researcher`, `opencode-developer-researcher`, `qwen-code-skill`, `goose-cli-skill`
- Use `agent-browser` for any browser automation tasks.
- If you discover new Slack/OpenCode updates during development, update the matching skill doc under `.agents/skills/` (mirrored via `.claude/skills/`).

## Agent live status workflow
- Use `packages/live-status-harness/fixed-prompt.md` as the baseline stream-capture prompt.
- Capture stream events with `bun run live-status:capture --provider <opencode|claudecode|codex|kimi|kiro|kilo|qwen|goose|gemini>`.
- Store raw ordered events in Redis under the harness keyspace (`harness:live_status:*`).
- Render status outputs from captured events with `bun run live-status:render --run-id <runId>`.
- Keep harness scripts in `packages/live-status-harness/` so stream capture/testing stays decoupled from the normal Ode runtime.
- Before changing live status parsing/formatting, replay a captured run and verify output changes intentionally.
- For new agent integrations, add at least one harness fixture and one deterministic render test.
