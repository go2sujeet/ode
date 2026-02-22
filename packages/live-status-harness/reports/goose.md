# Live Status Harness Report - goose

Generated: 2026-02-22T11:06:45.423Z
Provider: goose
Working directory: /root/ode-new/.worktree/ode_1771752635.512539

- Run ID: goose_1771757884861_7e7c6a15
- Events captured: 752
- Status updates rendered: 8

## Final Live Status Message

```text
*Goose is running...* (1m 25s)
_Waiting_

*Tool execution*
- `todo__todo_write`
- `subagent`
```

## Result Message

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
