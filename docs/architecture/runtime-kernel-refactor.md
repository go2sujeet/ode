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
- `RequestRun`: one active model run with explicit `RequestPhase`.
- `SessionService`: session/worktree/provider bootstrap only.
- `StatusPublisher`: status/final publish strategy.
- `EventProjector`: projects stream events into typed status view.
- `RuntimeStore`: persistence contract.

## Key value objects

- `BotKey = { platform, botId }`
- `ThreadKey = { botKey, channelId, threadId }`
- `RawInboundEvent` (platform-neutral ingress payload)
- `InboundDecision = ignore | command | stop | message`

## Inbound flow

1. `PlatformGateway` emits `RawInboundEvent`.
2. `RuntimeKernel` resolves `BotRuntime` by `BotKey`.
3. `BotRuntime` uses platform `InboundAdapter` to evaluate inbound.
4. `command` routes to `CommandService`.
5. `message/stop` routes to `ThreadRuntime` via `ThreadRuntimeRegistry`.
6. `ThreadRuntime` serializes execution and launches `RequestRun`.

## Planned removals after parity

- `CoreStateMachine` (phase lives on `RequestRun`).
- `incoming-message-processor.execute(...)` callback style.
- `scopeChannelId/parseScopedChannelId` string scoping.
- monolithic `createCoreRuntime` closure as primary runtime model.

## Migration slices

1. Add value objects + new kernel skeleton (no behavior change).
2. Introduce `RuntimeKernel` behind compatibility wrapper.
3. Route one platform through adapters + `BotRuntime`, keep `LEGACY_INBOUND_PATH=1` as rollback.
4. Cut over remaining platforms and keep the same rollback switch.
5. Remove legacy concepts after test/harness parity.
