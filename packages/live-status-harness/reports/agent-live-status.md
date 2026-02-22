# Live Status Harness Report

Generated: 2026-02-22T11:06:45.423Z
Working directory: /root/ode-new/.worktree/ode_1771752635.512539
Providers: opencode, claudecode, codex, kimi, kiro, kilo, qwen, goose, gemini

| Provider | Run ID | Events | Statuses | State |
| --- | --- | ---: | ---: | --- |
| opencode | opencode_1771756700380_e8233afa | 866 | 146 | ok |
| claudecode | (not completed) | 0 | 0 | failed |
| codex | codex_1771757062783_22a91ed8 | 83 | 82 | ok |
| kimi | (not completed) | 0 | 0 | failed |
| kiro | kiro_1771757149760_9f10c8ac | 30 | 25 | ok |
| kilo | kilo_1771757203411_292f1613 | 8 | 8 | ok |
| qwen | qwen_1771757570446_8867e8d0 | 311 | 111 | ok |
| goose | goose_1771757884861_7e7c6a15 | 752 | 8 | ok |
| gemini | gemini_1771757971028_122d2f73 | 161 | 95 | ok |

## opencode

- Run ID: opencode_1771756700380_e8233afa
- Events captured: 866
- Status updates rendered: 146

### Final Live Status Message

```text
*Opencode is running...* (gpt-5.3-codex, 38k tokens, build, 1m 1s)
_Waiting_

*Tool execution (Last 6 items in 27)*
- `read` packages/core/web/routes
- `read` packages/core/web/routes/config.ts
- `read` packages/core/web/routes/workspaces.ts
- `read` packages/core/web/routes/action.ts
- `read` packages/config/network.ts
- `read` packages/core/web/app.ts
```

### Result Message

```text
✅ Read pass complete. I reviewed the top-level docs plus core runtime/config/web API paths (not just README), and did 1 focused code search (`TODO|FIXME|HACK|XXX`) with 7 matches (mostly tests/harness, nothing critical).

The single most important change: add authentication/authorization to the local web API (`/api/*`), especially config and action routes.

Why this is highest priority:
- The web server exposes sensitive operations (`/api/config` read/write, `/api/action` message actions, workspace token handling).
- There is currently no auth guard in `packages/core/web/app.ts` or route handlers.
- README explicitly suggests exposing the UI with `ODE_WEB_HOST=0.0.0.0`, which turns this into a real security risk (token/config leakage + remote control of bot actions).

Plan to fix it:
1. ✅ Define security model
- Local-only mode default: keep current `127.0.0.1` behavior.
- Exposed mode (`0.0.0.0` or non-loopback): require API auth token for all `/api/*` routes.

2. ✅ Add middleware-level API auth
- Add a shared guard in `packages/core/web/app.ts` that checks `Authorization: Bearer <token>` (or `X-Ode-Token`) before any `/api/*` handler runs.
- Return `401` for missing/invalid token.

3. ✅ Add config/env support
- Add `ODE_WEB_API_TOKEN` (required when host is non-loopback; optional on loopback).
- On startup, warn loudly (or refuse to start) if host is non-loopback and token is missing.

4. ✅ Keep UX workable
- Inject token in Web UI API client calls so settings page still works.
- Keep static assets (`/`) public, but secure only `/api/*`.

5. ✅ Add tests
- Add route tests in `packages/core/test/web-routes.test.ts`:
  - loopback without token works
  - non-loopback without token fails
  - valid token succeeds
  - invalid token fails

6. ✅ Document migration
- Update `README.md` and `.env.example` with secure exposure instructions and examples.

If you want, I can implement this in a minimal backward-compatible way first (warn on insecure config now, enforce token in the next step), or enforce immediately.
```

## claudecode

- Run ID: (not completed)
- Events captured: 0
- Status updates rendered: 0
- Error: Error: Claude CLI timed out
    at <anonymous> (/root/ode-new/.worktree/ode_1771752635.512539/packages/agents/runtime/base.ts:83:18)

## codex

- Run ID: codex_1771757062783_22a91ed8
- Events captured: 83
- Status updates rendered: 82

### Final Live Status Message

```text
*Codex is running...* (334k tokens, 1m 21s)
_Drafting response_

*Tool execution (Last 6 items in 30)*
- `Bash` /bin/bash -lc "sed -n '1,240p' packages/config/index.ts"
- `Bash` /bin/bash -lc "sed -n '1,260p' README.md"
- `Bash` /bin/bash -lc "nl -ba packages/config/local/sessions.ts | sed -n '300,360p'"
- `Bash` /bin/bash -lc "nl -ba packages/ims/slack/message-router.ts | sed -n '220,320p'"
- `Bash` /bin/bash -lc "nl -ba packages/core/runtime.ts | sed -n '228,270p'"
- `Bash` /bin/bash -lc 'find . -maxdepth 3 -type f | wc -l'
```

### Result Message

```text
*Checklist*
✅ done Read core runtime, Slack router, session persistence, and request lifecycle paths
✅ done Repo scan/search summary: 62 files discovered (`find . -maxdepth 3 -type f`)
✅ done No edits made (analysis-only pass)

Most important change: make inbound message deduplication durable (not in-memory only).

Why this is highest impact:
- Duplicate-event protection currently depends on a process-local `Set`, so a restart loses dedupe state (`packages/config/local/sessions.ts:322`).
- Incoming Slack messages are fed directly to runtime processing with `message.ts` as ID (`packages/ims/slack/message-router.ts:280`).
- Runtime only checks the in-memory dedupe set before enqueueing (`packages/core/runtime.ts:236`).

That means retries/replays after restart can re-trigger the same request (extra cost, repeated writes, conflicting bot actions).

Plan to fix:
1. Add persistent dedupe store with TTL
- Implement a small local file-backed or Redis-backed cache keyed by `platform:channel:thread:messageId` plus timestamp.
- Keep entries for 24h (or configurable), prune periodically.

2. Switch runtime dedupe API to persistent checks
- Replace current `isMessageProcessed/markMessageProcessed` calls with async store-backed versions.
- Do atomic “check-and-mark” to avoid race conditions.

3. Use platform-native IDs when available
- For Slack, also include `event_id` (if accessible) in the key to improve replay safety.

4. Add deterministic tests
- Cover: duplicate in same process, duplicate after simulated restart, TTL expiration, and race (parallel same message).

5. Add observability
- Log counters for `dedupe_hit`, `dedupe_miss`, and store errors so regressions are visible quickly.
```

## kimi

- Run ID: (not completed)
- Events captured: 0
- Status updates rendered: 0
- Error: Error: Kimi returned empty response
    at parseKimiResponse (/root/ode-new/.worktree/ode_1771752635.512539/packages/agents/kimi/client.ts:104:15)
    at <anonymous> (/root/ode-new/.worktree/ode_1771752635.512539/packages/agents/kimi/client.ts:190:20)
    at async withSessionLock (/root/ode-new/.worktree/ode_1771752635.512539/packages/agents/runtime/base.ts:176:20)
    at async sendMessage (/root/ode-new/.worktree/ode_1771752635.512539/packages/agents/kimi/client.ts:158:26)
    at async main (/root/ode-new/.worktree/ode_1771752635.512539/packages/live-status-harness/scripts/capture-stream.ts:328:40)
    at processTicksAndRejections (native:7:39)

## kiro

- Run ID: kiro_1771757149760_9f10c8ac
- Events captured: 30
- Status updates rendered: 25

### Final Live Status Message

```text
*Kiro is running...* (53s)
_Waiting_

*Tasks*
`completed` Generate codebase overview

*Tool execution (Last 6 items in 13)*
- `Bash`
- `Bash`
- `Bash`
- `Grep` AgentProviderId.*=.*opencode.*claudecode.*codex (*.ts) in .
- `Grep` agentProviderSchema.*=.*z\.enum (*.ts) in .
- `Read` packages/agents/registry.ts (offset 0, limit 100)
```

### Result Message

```text
Based on my exploration, here's what I found:
## Most Important Issue: Agent Provider Type Duplication
The codebase has 34,146 lines of tests but only 22,825 lines of actual code - that's a 1.5:1 test-to-code ratio, which is excellent. However, there's a critical maintenance issue:
The agent provider list is hardcoded in 13+ different locations across the codebase:
- packages/agents/registry.ts - AgentProviderId type
- packages/config/local/ode.ts - agentProviderSchema (Zod)
- packages/ims/slack/commands.ts - AgentProvider type + array
- packages/config/local/redis.ts - SessionAgentProvider type
- packages/live-status-harness/scripts/generate-report.ts - DEFAULT_PROVIDERS array
- packages/utils/status.ts - AgentStatusProvider type + PROVIDER_FALLBACK_TITLES
- And more...
Every time a new agent is added (like when you added Kiro), you need to update all these locations. Miss one, and you get runtime errors or missing features.
## Plan to Fix
✅ Create single source of truth
- Define agent list once in packages/agents/registry.ts
- Export both the type and runtime array
✅ Replace all duplicates
- Update Zod schema to derive from registry
- Update all type definitions to import from registry
- Update all arrays/objects to use registry constant
✅ Add compile-time safety
- Use TypeScript's satisfies to ensure objects match the type
- Add exhaustiveness checks where needed
This will reduce maintenance burden and prevent bugs when adding new agents.
```

## kilo

- Run ID: kilo_1771757203411_292f1613
- Events captured: 8
- Status updates rendered: 8

### Final Live Status Message

```text
*Explore Ode repo structure* (6m 6s)
_Working_

*Tool execution*
- `task` Explore Ode repo structure
```

### Result Message

```text
Based on my exploration, here's my assessment:

---

## Most Important Change: *Missing Circuit Breaker for Agent Calls*

Your bot bridges Slack → AI agents, but when an agent fails (API timeout, rate limit, crash), there's **no protection against cascading failures**. The runtime will keep hammering a failing agent, threads get stuck in "processing" state, and users see no feedback.

---

## Plan to Fix It

**1. Create a circuit breaker utility**
- Add `packages/utils/circuit-breaker.ts`
- States: closed → open → half-open
- Configurable failure threshold and reset timeout
- Per-provider breaker instance

**2. Wrap agent adapter calls**
- In `packages/agents/adapter.ts`, wrap `runAgent()` calls
- Return structured error when circuit is open
- Include retry-after hint for user feedback

**3. Update state machine**
- In `packages/core/state-machine.ts`, handle `CircuitOpenError`
- Transition to `failed` state with actionable message
- Rate limit retries while circuit is open

**4. Add health monitoring**
- Expose breaker status via web API (`/api/health`)
- Log breaker state transitions
- Optional: auto-disable channels for failing providers

---

Want me to implement this?
```

## qwen

- Run ID: qwen_1771757570446_8867e8d0
- Events captured: 311
- Status updates rendered: 111

### Final Live Status Message

```text
*Qwen is running...* (5m 14s)
_Finalizing response_

*Tool execution (Last 6 items in 17)*
- `glob` **/config/**/*.ts in .
- `read` tsconfig.json
- `read` packages/config/index.ts
- `bash` cd /root/ode-new/.worktree/ode_1771752635.512539 && bun test 2>&1 | head -100
- `read` package.json
- `bash` cd /root/ode-new/.worktree/ode_1771752635.512539 && bun test --timeout=30000 2>&1 | tail -50
```

### Result Message

```text
Good! I can see the test results. Now let me analyze what I've learned:

## Analysis Complete

**Most Important Thing to Change: Add proper test isolation for web server tests**

The test suite has a critical issue: `packages/core/test/web-routes.test.ts` fails with `"Cannot find package 'elysia'"` even though it's installed in `package.json`. This indicates the test is trying to import from the wrong path or there's a module resolution issue that breaks test reliability.

Additionally, the tests took **60+ seconds** to run 126 tests - there's likely unnecessary I/O or lack of proper mocking.

---

## Plan to Fix

* not started - Investigate `web-routes.test.ts` import structure and identify why elysia can't be resolved
* not started - Fix module resolution issues in web server tests
* not started - Add proper mocking for expensive I/O operations (Redis, file system, network)
* not started - Run full test suite and verify all tests pass in under 30 seconds
* not started - Add a CI-friendly test script with proper timeouts

**Why this matters:** Unreliable tests block confident refactoring and slow down development. The `elysia` import failure suggests the test environment isn't properly configured, which could hide real bugs.
```

## goose

- Run ID: goose_1771757884861_7e7c6a15
- Events captured: 752
- Status updates rendered: 8

### Final Live Status Message

```text
*Goose is running...* (1m 25s)
_Waiting_

*Tool execution*
- `todo__todo_write`
- `subagent`
```

### Result Message

```text
## Repository Analysis Complete

Based on my exploration of the Ode codebase, here's what I found:

---

## 🎯 The Most Important Change

**Add Structured Error Handling & Observability**

This Slack bot is a production system bridging users to AI agents, but has **no error tracking, structured logging, or monitoring**. When things fail (and they will), you're flying blind.

---

## 📋 Implementation Plan

### Phase 1: Foundation (Core Logging)
**File**: `src/config/logger.ts` (new)
` ` `typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    error: pino.stdSerializers.err,
  },
});
` ` `
**Impact**: Every log becomes queryable JSON with correlation IDs

### Phase 2: Error Tracking
**File**: `src/config/sentry.ts` (new)
` ` `typescript
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
` ` `
**Impact**: Automatic error aggregation with stack traces & context

### Phase 3: Request Context
**File**: `src/middleware/context.ts` (new)
` ` `typescript
import { AsyncLocalStorage } from 'async_hooks';

export type RequestContext = {
  correlationId: string;
  channelId: string;
  userId?: string;
  startTime: number;
};

export const contextStorage = new AsyncLocalStorage<RequestContext>();
` ` `
**Impact**: Trace any request from Slack → Ode → OpenCode end-to-end

### Phase 4: Health Endpoint
**File**: `src/health.ts` (new)
` ` `typescript
app.get('/health', async (req, res) => {
  const checks = {
    slack: await checkSlackConnection(),
    opencode: await checkOpenCodeConnection(),
    storage: await checkStorageAccess(),
    redis: await checkRedisConnection(),
  };
  
  const healthy = Object.values(checks).every(c => c.ok);
  res.status(healthy ? 200 : 503).json(checks);
});
` ` `
**Impact**: Infrastructure monitoring & automated alerts

### Phase 5: Integration
- Wrap `src/slack/` command handlers with error boundaries
- Add timing logs to `src/agents/opencode/` SDK calls
- Correlate status messages with request traces
- Add error reactions to failed Slack messages (🚫 or ⚠️)

---

## 🚀 Quick Start Commands

` ` `bash
# Install dependencies
bun add pino pino-pretty @sentry/node async_hooks

# Add environment variables
echo "LOG_LEVEL=debug" >> .env
echo "SENTRY_DSN=..." >> .env

# Test logging
bun run src/test-logger.ts
` ` `

---

## 💬 Why This Matters Most

Without observability, you can't:
- Debug production failures without SSH access
- Detect when OpenCode API is down
- Track error rates per channel
- Measure agent response times
- Proactively fix issues before users notice

This is foundational infrastructure. Everything else (features, UX, optimizations) builds on reliable observability.

---

Want me to implement this? I can create the files and integrate logging into the existing codebase.
```

## gemini

- Run ID: gemini_1771757971028_122d2f73
- Events captured: 161
- Status updates rendered: 95

### Final Live Status Message

```text
*Gemini is running...* (7m 14s)
_Finalizing response_

*Tool execution (Last 6 items in 32)*
- `read` packages/agents/index.ts
- `read` packages/core/index.ts
- `read` packages/config/message-update-interval.ts
- `read` packages/core/runtime/thread-queue.ts
- `read` packages/agents/runtime/base.ts
- `read` packages/core/runtime/session-bootstrap.ts
```

### Result Message

```text
I'll start by exploring the codebase to understand its structure and identify the most critical improvement.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll read `package.json` and list the `packages` directory to get a better sense of the project's dependencies and modularity.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll explore the `core` and `agents` packages to understand the system's architecture and identify potential areas for improvement.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll examine `packages/core/runtime.ts` and `packages/agents/registry.ts` to understand the system's core execution and agent registration logic.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll examine `packages/core/runtime/open-request.ts` to see how it handles requests for providers that don't support event streams and how updates are communicated to the user.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll examine `packages/core/runtime/request-runner.ts` to see how it manages the `liveParsedState` and how it interacts with the `onProgressTick` to update the status message.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll investigate `packages/core/runtime/event-stream.ts` to understand how `startEventStreamWatcher` functions, particularly for providers lacking event stream support, as this could reveal issues with user experience or system stability.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll investigate the implementation of the `claudecode` and `gemini` agents to see if they provide any updates before `sendMessage` finishes, despite not supporting event streams.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll examine `packages/agents/claude/index.ts` to see how it handles messages and if it offers any intermediate updates.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I'll examine `packages/agents/claude/client.ts` to see how it handles messages and if it offers any intermediate updates.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I've discovered that while the Claude agent publishes events during execution, the core system ignores them because `supportsEventStream` is set to `false`. I'll now examine `packages/agents/runtime/base.ts` to understand how `publishSessionEvent` and `subscribeToSession` function, as this oversight prevents users from seeing progress updates for Claude.

* ♻️ Researching repository structure and key components
* * Identifying the most important change
* * Developing a fix plan

I've pinpointed the problem: the core runtime skips progress updates for CLI-based agents like Claude and Gemini because `supportsEventStream` is set to `false`, leaving users with a static message during long runs. I plan to fix this by enabling `supportsEventStream` for these agents and ensuring `startEventStreamWatcher` correctly processes their events. Now, I'll examine `packages/utils/index.ts` to understand how `buildSessionMessageState` handles event parsing.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

I'll examine `packages/utils/session-inspector.ts` to see how it handles session events and builds the message state.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`buildSessionMessageState` already supports various providers, so I just need to enable `supportsEventStream` for CLI-based agents like Claude and Gemini in `packages/agents/registry.ts`. These agents use `CliAgentRuntime` and provide streaming feedback, which `startEventStreamWatcher` should handle correctly. I'll now verify that all listed agents indeed support streaming and then apply the change.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

I'm enabling interactive progress for all users by updating the UX for CLI agents. Before I proceed, I'll check the `AgentAdapter` interface in `packages/core/types.ts`.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`AgentAdapter` includes `supportsEventStream: boolean`, but `startEventStreamWatcher` skips `question.asked` events when it's `false`, preventing Claude and Gemini users from answering interactive questions via Slack. To fix this critical limitation, I'll enable event stream support for all agents in `packages/agents/registry.ts`, ensuring real-time updates and interactive Q&A. I'll also verify `Claude`'s `normalizeQuestions` implementation in `packages/agents/claude/client.ts`.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

If `normalizeQuestions` isn't in `client.ts`, it might be in `packages/agents/adapter.ts` for the `AgentAdapter` implementation. I'll check there.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

**Discrepancy Investigation**

I've discovered that while `AgentAdapter`'s `supportsEventStream` is hardcoded to `true`, the underlying `AgentProvider` (like `claudecode`) might have it set to `false`. Interestingly, `claudecode` *does* produce events. To solve this, I'll examine `packages/core/runtime/status-message.ts` to see how it handles these potentially conflicting states.


I'll check `packages/core/runtime/status-message.ts`.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

I'll check `packages/utils/status.ts` as `buildStatusMessageByProvider` is delegated there.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`AgentAdapter.supportsEventStream` is hardcoded to `true`, so `startEventStreamWatcher` should run. However, `AgentProvider` in `registry.ts` has its own `supportsEventStream` property, which is `false` for Claude. I need to find where `createCoreRuntime` is called, likely in `packages/core/index.ts` or `packages/core/cli.ts`, to see how these properties interact and if they're causing the issue I suspect.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

I'll check `packages/ims/slack/client.ts`.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`createAgentAdapter()` is used, which has `supportsEventStream: true`, so `startEventStreamWatcher` should be active for all agents. For Claude, `subscribeToSession` should also work. I'm confused why `registry.ts` has `supportsEventStream: false` for most agents and will grep the project to see if it's used elsewhere.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`AgentAdapter.supportsEventStream` is `true`, while `AgentProvider.supportsEventStream` is `false`, with the latter seemingly used only in `registry.ts` and tests. I'll check `packages/agents/index.ts` to see if it re-exports this value.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`packages/agents/index.ts` re-exports `supportsEventStream` from the selected provider, but `createAgentAdapter` in `adapter.ts` uses `registry.ts` and hardcodes `supportsEventStream: true`. `createCoreRuntime` uses this adapter, meaning `startEventStreamWatcher` in `packages/core/runtime/event-stream.ts` should see `true`. I'll now check `packages/core/index.ts` to see if there's any other interaction I've missed.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`createCoreRuntime` uses `createAgentAdapter`, which has `supportsEventStream: true`, so `startEventStreamWatcher` should be active. However, `startEventStreamWatcher`'s `onUpdate` is empty, meaning events update state but don't trigger immediate message updates. Updates only happen via `onProgressTick`'s `setInterval`, which depends on `progressIntervalMs`. I'll now check `packages/config/message-update-interval.ts` to see that interval.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`AgentAdapter` hardcodes `supportsEventStream: true`, allowing `startEventStreamWatcher` to run for all agents, including Claude. However, `AgentAdapter` throws an error when attempting to reply to questions for any agent other than `opencode`, which is a major limitation since Claude supports interactive questions. I've also noted an inconsistency between `AgentAdapter` and `AgentProvider` regarding `supportsEventStream`. My plan is to improve CLI agent reliability and interactivity by fixing this inconsistency, enabling question replies for more agents, and investigating stdin support for Claude replies. I'm also considering `packages/core/runtime/thread-queue.ts` for potential critical improvements.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

`ThreadMessageQueue` combines messages, which could disrupt question replies. However, the lack of interactivity for CLI agents like Claude is a bigger issue. Currently, `sendMessage` spawns a new, non-interactive CLI process with `stdin` closed, making interactive questions impossible and inefficient. I've identified that `AgentAdapter` also hardcodes `supportsEventStream: true`, but its `replyToQuestion` throws for non-OpenCode agents. 

My plan is to refactor CLI agent execution:
1. Keep `stdin` open in `CliAgentRuntime`.
2. Implement `writeToSessionStdin` in `CliAgentRuntime` and update `AgentAdapter` to use it for question replies.
3. Correct `supportsEventStream` in the registry for all event-producing agents. 
This will allow `sendMessage` to wait for question replies while `onProgressTick` updates Slack with buttons, making CLI agents fully interactive. I'll begin with `packages/agents/runtime/base.ts`.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

I'll first update `packages/agents/runtime/base.ts` by adding `writeToSessionStdin` to `CliAgentRuntime` and an `interactive: boolean` flag to `RunCliJsonCommandParams` to keep `stdin` open. Since the user's request for a plan is an inquiry, I'll provide the identification and strategy without modifying files yet, per my instructions. I've identified the lack of CLI agent interactivity as a major UX gap and will also briefly check `packages/core/runtime/session-bootstrap.ts` for any other critical issues.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ♻️ Developing a fix plan

I've identified that CLI agents like Claude and Gemini are hampered by non-interactive execution, a restrictive 5-minute timeout, and closed `stdin`. This results in missing progress updates, an inability to answer interactive questions, and frequent timeouts. My plan to fix this involves updating `CliAgentRuntime` to support interactive `stdin` and longer timeouts, enabling `supportsEventStream` for these agents in the registry, and implementing a `replyToQuestion` method in `AgentAdapter` that bridges Slack actions to the running process. I'll also need to update the `AgentProvider` interface to include `replyToQuestion`.

* ♻️ Researching repository structure and key components
* ✅ Identifying the most important change
* ✅ Developing a fix plan

After reviewing the repository, I have identified a critical architectural limitation that significantly impacts the user experience and functionality of CLI-based agents (Claude, Gemini, etc.).

### 🚨 Most Important Change: Enable Interactivity for CLI Agents
Currently, CLI agents are executed as non-interactive, blocking subprocesses with `stdin` closed immediately and a strict 5-minute timeout. This leads to several major issues:
1.  **Static UI:** Progress updates (tool use, thinking steps) are ignored for most agents because they are marked as `supportsEventStream: false`, even though they produce parseable JSON streams.
2.  **Broken Interactivity:** Users cannot answer interactive questions (like Claude's `AskUserQuestion`) because the process cannot receive input via `stdin`, and the system hard-throws an error when attempting to reply to non-OpenCode agents.
3.  **Premature Timeouts:** Complex coding tasks frequently fail due to a hardcoded 5-minute timeout that is insufficient for real-world agentic workflows.

### 📋 The Fix Plan

I propose a "Modernize CLI Agent Support" initiative to transform these static integrations into fully interactive ones.

#### 1. Enhance CLI Runtime Capability
*   **File:** `packages/agents/runtime/base.ts`
*   Update `runCliJsonCommand` to support an optional `interactive` mode that keeps `stdin` open.
*   Add `writeToSessionStdin(sessionId, text)` to `CliAgentRuntime` to allow piping Slack/IM responses back to the running process.
*   Increase the default `timeoutMs` from 5 minutes to 30 minutes to accommodate complex tasks.

#### 2. Unlock Event Streaming
*   **File:** `packages/agents/registry.ts`
*   Update all CLI-based providers (`claudecode`, `gemini`, `goose`, etc.) to set `supportsEventStream: true`. The underlying infrastructure already exists to parse their events, but it's currently disabled.
*   **File:** `packages/agents/adapter.ts`
*   Remove hardcoded `supportsEventStream: true` and instead delegate to the active provider's capability.

#### 3. Implement Interactive Question Bridging
*   **File:** `packages/agents/registry.ts`
*   Add `replyToQuestion(sessionId, answers)` to the `AgentProvider` interface.
*   **File:** `packages/agents/adapter.ts`
*   Update the `replyToQuestion` implementation to remove the "opencode-only" restriction. For CLI agents, it will now bridge the user's response to the process's `stdin`.

#### 4. Update Agent Adapters (e.g., Claude)
*   **File:** `packages/agents/claude/client.ts`
*   Update `sendMessage` to leverage the interactive mode and longer timeouts, ensuring it can wait for and receive user input during a task.

This change will make the entire "agent orchestrator" feel significantly more responsive and capable, allowing it to handle complex, multi-step interactive sessions with any supported CLI agent.
```
