# New Agent Live Status Report

Generated: 2026-06-10

Prompt used for the latest OpenHands/Crush verification:

```text
Read-only task. Inspect this repository enough to answer:
1. What are the main runtime entry points?
2. Which package owns agent provider integration?
3. Name one concrete test you would add for live status rendering.
Use tools when useful, but do not modify files. Keep the final answer under 8 bullets.
```

Note: elapsed text inside rendered status snippets is computed at render time, not at the historical snapshot timestamp. Use the listed offset for 30s/60s interpretation.

| Provider | Run ID | Events | Statuses | 30s assessment | 60s assessment |
| --- | --- | ---: | ---: | --- | --- |
| pi | `pi_1781100814_ode_new_agents` | 387 | 135 | Tool-level activity with paths | Tool history + thinking summary |
| codebuddy | `codebuddy_1781101200_ode_new_agents` | 648 | 136 | Agent task titles visible | Agent task titles visible |
| openhands | `openhands_watcher_1781102992` | 38 | 36 | First tool event at 31s | Tool history visible |
| crush | `crush_dbwatch2_1781103374` | 27 | 18 | Completed at 20s with tool history | Completed at 20s with tool history |

## Baseline Comparison

Claude Code baseline (`claudecode_1771995340966_bab08ba8`) renders task and tool history such as `TodoWrite`, `Read`, and `Bash` items, with the final status showing 28 total tool entries. OpenCode baseline (`opencode_1771939457162_c232cd98`) renders concrete `read` / `grep` activity, including file paths from `packages/config` and `packages/core/web`.

The target for new providers is therefore not just "agent is alive"; it is a status message with enough context to answer what the agent is doing: current phase, model/token data when available, recent tools, and useful tool details such as paths, grep patterns, shell commands, or delegated task names.

## Pi

30s snapshot, nearest status at 29s:

```text
*Pi is running...*
_Running tool: read - /Users/kailiu/Code/ode/packages/core/cli.ts_

*Tool execution*
- `ls` Users/kailiu/Code/ode
- `read` package.json
- `ls` packages
~ `find` **/*.ts
~ `read` packages/core/index.ts
~ `read` packages/core/cli.ts
```

60s snapshot, nearest status at 64s:

```text
*Pi is running...*
_Thinking: Let me look at error handling, recovery patterns, and database structure to understand the..._

*Tool execution (Last 6 items in 12)*
- `ls` packages/agents
- `read` packages/core/kernel/request-run.ts
- `find` *.test.ts
- `read` packages/core/kernel/recovery.ts
- `grep` error|Error|catch|try in packages/core/kernel
- `read` packages/config/local/inbox.ts
```

Result: Pi is now comparable to Claude/OpenCode for basic tool visibility. It surfaces thinking deltas, tool names, file paths, grep patterns, and tool completion.

## CodeBuddy

30s snapshot, nearest status at 26s:

```text
*CodeBuddy is running...* (gpt-5.1, 24k tokens)
_Drafting response_

*Tool execution*
~ `Agent` Map core architecture
~ `Agent` Inspect testing gaps
- `Agent` Check config and security
```

60s snapshot, nearest status at 54s:

```text
*CodeBuddy is running...* (gpt-5.1, 25k tokens)
_Drafting response_

*Tool execution (Last 6 items in 7)*
~ `Agent` Inspect testing gaps
- `Agent` Check config and security
~ `Agent` Map core architecture
~ `Agent` Inspect testing gaps
- `Agent` Check config and security
- `Agent` Survey repo priorities
```

Result: CodeBuddy's generic `Agent` tool now includes the task description recovered from `input_json_delta` / assistant tool input.

## OpenHands

30s snapshot, nearest status at 30s:

```text
*OpenHands is running...* (anthropic/claude-sonnet-4-5-20250929)
_Waiting for OpenHands output (30s): Read-only task. Inspect this repository enough to answer: 1. What are the main runtime entry points? 2. Which package owns agent provider..._
```

First tool status after 30s, at 31s:

```text
*OpenHands is running...* (anthropic/claude-sonnet-4-5-20250929)
_Running tool: file_editor - View repository root structure_

*Tool execution*
~ `file_editor` View repository root structure
```

60s snapshot, nearest status at 60s:

```text
*OpenHands is running...* (anthropic/claude-sonnet-4-5-20250929)
_Waiting for OpenHands output (60s): Read-only task. Inspect this repository enough to answer: 1. What are the main runtime entry points? 2. Which package owns agent provider..._

*Tool execution*
- `file_editor` View repository root structure
- `file_editor` View core package structure
- `file_editor` View agents package structure
- `file_editor` View live status harness structure
```

Ode now watches local OpenHands conversation event files (`~/.openhands/conversations/<id>/events/event-*.json`) because this CLI mode buffers stdout JSON blocks until completion. The watcher publishes `ActionEvent` / `ObservationEvent` records while the process is still running, then the stdout replay is deduped when OpenHands exits.

```text
_Running tool: file_editor - View packages/core/index.ts to understand runtime entry_

*Tool execution*
~ `file_editor` View packages/core/index.ts to understand runtime entry
```

Result: OpenHands is now comparable to Claude/OpenCode after the first conversation event file appears. It still needs the heartbeat before the first event file exists, but it no longer stays heartbeat-only through the whole run.

## Crush

The verified run completed at 20s, so the nearest 30s/60s snapshots are the final status:

```text
*Crush session cdd83f17* (gpt-5.1)
_Finalizing response_

*Tool execution*
- `ls` Users/kailiu/Code/ode
- `grep` live status|live-status|render in Users/kailiu/Code/ode
- `grep` Runtime entry|CLI entry|Agent adapters in Users/kailiu/Code/ode
- `view` AGENTS.md
- `view` packages/live-status-harness/test/render-status.test.ts
- `view` packages/live-status-harness/README.md
```

Mid-run DB watcher status from the same verification:

```text
*Crush session cdd83f17* (gpt-5.1)
_Finished tool: grep - Runtime entry|CLI entry|Agent adapters in /Users/kailiu/Code/ode_

*Tool execution*
- `ls` Users/kailiu/Code/ode
- `grep` live status|live-status|render in Users/kailiu/Code/ode
- `grep` Runtime entry|CLI entry|Agent adapters in Users/kailiu/Code/ode
```

Ode now watches `workingPath/.crush/crush.db` and converts assistant message `parts` (`tool_call`, `tool_result`, `text`) into live status updates. This is needed because `crush run --verbose` exposes useful session/model logs but not structured tool calls on stdout/stderr.

Result: Crush is now comparable to Claude/OpenCode for this workflow: the live message includes concrete commands, grep patterns, file views, and completion state rather than only a session heartbeat.
