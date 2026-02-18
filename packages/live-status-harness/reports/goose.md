# Live Status Harness Report - goose

Generated: 2026-02-18T08:47:02.913Z
Provider: goose
Working directory: /root/ode-new/.worktree/ode_1771345735.694879

- Run ID: goose_1771348841252_331d0042
- Events captured: 1136
- Status updates rendered: 31

## Final Live Status Message

```text
*Goose Working...* (926m 21s)
_Waiting_

*Tool execution (Last 6 items in 10)*
- `apps__create_app`
- `extensionmanager__read_resource`
- `subagent`
- `skills__loadSkill`
- `extensionmanager__read_resource`
- `todo__todo_write`
```

## Result Message

```text
---

## Plan to Fix: Global Error Handlers

Here's the complete implementation plan:

### 📁 Files to Modify
- `src/index.ts` - Add error handlers
- `src/utils/error-handler.ts` - *New module*

### 🔧 Implementation Steps

**Step 1: Create `src/utils/error-handler.ts`**

` ` `typescript
import { Logger } from 'winston';
import { Server } from 'http';
import { SlackNotifier } from '../slack';

interface ShutdownHandlers {
  storage?: { disconnect: () => Promise<void> };
  server?: Server;
}

export function setupGlobalErrorHandlers(
  logger: Logger,
  slack: SlackNotifier,
  handlers: ShutdownHandlers = {}
) {
  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason: unknown, promise: Promise<unknown>) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('Unhandled Promise Rejection', {
      error: error.message,
      stack: error.stack,
      promise
    });
    await slack.notifyError(error, 'Unhandled Rejection');
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error: Error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack
    });
    await slack.notifyError(error, 'Uncaught Exception');
    await gracefulShutdown(logger, handlers, 1);
  });

  // Handle termination signals
  process.on('SIGTERM', () => gracefulShutdown(logger, handlers, 0));
  process.on('SIGINT', () => gracefulShutdown(logger, handlers, 0));
}

async function gracefulShutdown(
  logger: Logger,
  handlers: ShutdownHandlers,
  exitCode: number
) {
  logger.info('Starting graceful shutdown...');
  
  try {
    // Close HTTP server
    if (handlers.server) {
      await new Promise<void>((resolve) => {
        handlers.server!.close(() => resolve());
        setTimeout(() => resolve(), 10000); // Force close after 10s
      });
    }

    // Close storage connections
    if (handlers.storage) {
      await handlers.storage.disconnect();
    }

    logger.info('Shutdown complete');
    process.exit(exitCode);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
}
` ` `

**Step 2: Modify `src/index.ts`**

Add this after the logger and slackNotifier initialization:

` ` `typescript
import { setupGlobalErrorHandlers } from './utils/error-handler';

// ... after logger and slackNotifier are initialized ...

// Setup global error handlers BEFORE starting server
setupGlobalErrorHandlers(logger, slackNotifier, {
  storage,
  server: null  // Will be set after app.listen()
});

// ... start server ...
const server = app.listen(PORT, () => {
  logger.info(`ODE Core System started on port ${PORT}`);
  slackNotifier.notify('ODE System started successfully');
});

// Update the handlers reference with the server instance
// (You may need to refactor this to pass the server after creation)
` ` `

### ✅ Testing Checklist

- [ ] Create test route `/test/unhandled-rejection` that throws in async without catch
- [ ] Create test route `/test/uncaught-exception` that throws synchronously
- [ ] Verify Slack notifications are sent for both
- [ ] Verify logs capture error details
- [ ] Send SIGTERM to process and verify graceful shutdown
- [ ] Verify no "hanging" connections after shutdown

### 🎯 Expected Outcome

| Before Fix | After Fix |
|------------|-----------|
| Process crashes on unhandled errors | Errors logged + Slack alert + graceful shutdown |
| No diagnostic information | Full stack traces captured |
| In-flight requests dropped | Connections closed cleanly |
| Silent failures | Team notified immediately |

This is a 30-minute fix that prevents production outages. Want me to implement it now?
```
