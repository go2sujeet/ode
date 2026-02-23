# Live Status Harness Report - kimi

Generated: 2026-02-23T08:36:02.161Z
Provider: kimi
Working directory: /root/ode-new/.worktree/ode_1771835686.471109

- Run ID: kimi_1771835717908_3998aa2f
- Events captured: 19
- Status updates rendered: 19

## Final Live Status Message

```text
*Kimi is running...* (44s)
_Drafting response_

*Tool execution (Last 6 items in 13)*
- `Grep` TODO|FIXME|XXX|HACK in .
- `Read` packages/core/runtime/request-runner.ts
- `Read` packages/config/local/sessions.ts
- `Grep` throw|Error in packages/core
- `Bash` find /root/ode-new/.worktree/ode_1771835686.471109 -name "*.test.ts" | wc -l && find /root/ode-new/....
- `Read` packages/core/runtime/helpers.ts
```

## Result Message

```text
Based on my analysis of this codebase, I've identified the key issue and have a plan to fix it.

## The Most Important Thing to Change

**Lack of graceful degradation when agent CLIs fail or hang**

The current implementation has a critical reliability gap: when an agent CLI (OpenCode, Claude, Codex, etc.) crashes, hangs, or exits unexpectedly, the system doesn't properly clean up session state, potentially leaving:
- Orphaned child processes running indefinitely  
- Active requests stuck in "processing" state forever
- Users without proper feedback about what happened
- Zombie sessions that can't be recovered

This affects the core value proposition of Ode as a bridge between chat apps and coding agents.

## Plan to Fix It

### Phase 1: Process Health Monitoring (Day 1)
* not started - Add heartbeat/health check for running CLI processes in `CliAgentRuntime`
* not started - Implement process timeout enforcement with configurable limits per agent
* not started - Add "stuck request" detection (requests processing >30 min with no output)

### Phase 2: Robust Cleanup & Recovery (Day 2)
* not started - Implement automatic cleanup of orphaned processes on startup
* not started - Add `forceStopSession` that kills process tree (not just SIGTERM)
* not started - Ensure session state transitions to "failed" when process exits unexpectedly

### Phase 3: User Experience (Day 3)
* not started - Improve error messages in `categorizeRuntimeError` for process crashes vs timeouts
* not started - Add "Session recovered after interruption" message when recovering stale sessions
* not started - Surface process exit codes to users for debugging

### Phase 4: Testing (Day 4)
* not started - Add integration tests simulating: process kill, timeout, hang
* not started - Verify cleanup works across all 9 supported agents

**Files to modify:**
- `packages/agents/runtime/base.ts` - Core runtime improvements
- `packages/core/runtime/request-runner.ts` - Request lifecycle handling  
- `packages/core/runtime/recovery.ts` - Startup cleanup logic
- `packages/core/runtime/helpers.ts` - Error categorization
- `packages/config/local/sessions.ts` - Session state management

Would you like me to implement this plan?
```
