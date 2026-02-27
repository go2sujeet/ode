# Runtime Kernel Refactor (High Risk / High Return)

## Core goals

- Collapse overlapping runtime concepts into a small OO model.
- Isolate runtime state by `(bot + channel + thread)`.
- Move inbound policy to explicit platform adapters.
- Remove callback-heavy orchestration and string-scoped channel hacks.

## Target model

- `RuntimeKernel`: top-level orchestrator for all bot runtimes.
- `BotRuntime`: per bot lane (`BotKey`), owns inbound adapter + thread registry.
- `ThreadRuntimeRegistry`: lifecycle and TTL for thread actors.
- `ThreadRuntime`: actor queue per `ThreadKey`.
- `RequestRun`: one active model run (open request, stream processing, finalize).
- `KernelRuntimeFacade`: runtime ingress orchestration and delegation to kernel services.

## Key value objects

- `BotKey = { platform, botId }`
- `ThreadKey = { botKey, channelId, threadId }`
- `RawInboundEvent` (platform-neutral ingress payload)
- `InboundDecision = ignore | command | stop | message`

## Inbound flow

1. `PlatformGateway` emits `RawInboundEvent`.
2. `RuntimeKernel` resolves `BotRuntime` by `BotKey`.
3. `BotRuntime` uses platform `InboundAdapter` to evaluate inbound.
4. `message/stop` routes to `ThreadRuntime` via `ThreadRuntimeRegistry`.
5. stop handling is delegated to `stop-command` service.
6. `ThreadRuntime` serializes execution and launches `RequestRun`.

## Planned removals after parity

- `CoreStateMachine` (removed).
- `incoming-message-processor.execute(...)` callback style (removed).
- `scopeChannelId/parseScopedChannelId` string scoping (not removed yet).
- monolithic `createCoreRuntime` closure as primary runtime model (replaced by `KernelRuntimeFacade`).

## Current status

- Kernel-only inbound path is live across Slack/Discord/Lark.
- Runtime execution lifecycle is consolidated in `packages/core/kernel/request-run.ts`.
- Session bootstrap, pending-question handling, stop handling, and recovery are in `packages/core/kernel/*`.
- `packages/core/runtime.ts` is a thin wrapper around `KernelRuntimeFacade`.

## Remaining gaps

- Move command parsing/handling behind explicit kernel command service when command routing is fully migrated.

## Migration slices

1. Add value objects + new kernel skeleton (no behavior change).
2. Introduce `RuntimeKernel` behind compatibility wrapper.
3. Route one platform through adapters + `BotRuntime`.
4. Cut over remaining platforms.
5. Remove legacy concepts after test/harness parity.
