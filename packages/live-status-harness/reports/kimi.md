# Live Status Harness Report - kimi

Generated: 2026-02-07T08:18:34.676Z
Provider: kimi
Working directory: /home/ode/ode/.worktree/ode_1770449813.006509

- Run ID: kimi_1770452278985_e29e2a0e
- Events captured: 28
- Status updates rendered: 28

## Final Live Status Message

```text
_35s_
_Drafting response_

*Tool execution (Last 6 items in 20)*
- `Read` packages/agents/adapter.ts
- `Bash` find . -name "*.test.ts" -o -name "*.spec.ts" | head -20
- `Read` packages/core/test/adapter-contracts.test.ts
- `Bash` wc -l packages/core/test/*.ts packages/agents/test/*.ts packages/live-status-harness/test/*.ts 2>/de...
- `Read` packages/config/local/sessions.ts
- `Read` packages/core/state-machine.ts
```

## Result Message

```text
After exploring the codebase, I've identified **one critical issue** that needs fixing:

---

## The Problem: No Timeout for Agent Requests

The `runTrackedRequest` function in `packages/core/runtime/request-runner.ts` has **no timeout mechanism**. If an AI agent (OpenCode, Claude, etc.) hangs or becomes unresponsive, the request stays stuck in "processing" state forever.

**Impact:**
- Users see "_Working..._" status indefinitely
- Thread is blocked (queue prevents concurrent requests)
- Requires manual bot restart or session cleanup

---

## Plan to Fix It

### 1. Add Timeout Configuration
- Add `ODE_REQUEST_TIMEOUT_MS` env var with 10 min default
- Store in config module

### 2. Implement Timeout in Request Runner
- Race `sendPrompt()` against a timeout promise
- On timeout: transition state to "failed", update status message

### 3. Update Error Categorization
- Ensure `categorizeRuntimeError` properly handles timeout errors

### 4. Add Recovery for Stuck Requests
- On startup, detect and fail requests exceeding timeout threshold

### 5. Expose in Settings UI
- Add timeout config to local settings page

This is a reliability fix that prevents silent failures and improves user experience significantly.
```
