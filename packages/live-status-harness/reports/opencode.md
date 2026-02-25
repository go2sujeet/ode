# Live Status Harness Report - opencode

Generated: 2026-02-25T05:17:38.758Z
Provider: opencode
Working directory: /root/ode-new/.worktree/ode_1771995140.206739

- Run ID: opencode_1771939457162_c232cd98
- Source: Reused Redis stream data
- Events captured: 862
- Status updates rendered: 142

## Final Live Status Message

```text
*Opencode is running...* (gpt-5.3-codex, 39k tokens, build, 953m 17s)
_Waiting_

*Tool execution (Last 6 items in 25)*
- `read` packages/config/web.ts
- `grep` function getWebHost|getWebHost\( in packages/config
- `read` packages/config/network.ts
- `read` packages/core/web/routes/config.ts
- `read` packages/core/web/local-settings.ts
- `read` packages/config/dashboard-config.ts
```

## Result Message

```text
♻️ in progress Reviewed repo structure and runtime entry points  
✅ done Searched TypeScript sources (100+ matches from `packages/**/*.ts`) and read the key web/API/config paths  
✅ done Identified the highest-impact issue

The most important change: add authentication/authorization to the local web API before anything else.

Right now, the config and action endpoints are open:
- `packages/core/web/routes/config.ts:9` exposes `GET /api/config` (includes workspace tokens like `slackBotToken`, `discordBotToken`, `larkAppSecret` from `packages/config/dashboard-config.ts:64`)
- `packages/core/web/routes/config.ts:18` allows unauthenticated config writes
- `packages/core/web/routes/action.ts:7` allows unauthenticated action execution (`post_message`, `ask_user`, etc.)
- `packages/core/web/app.ts:27` registers all these routes with no auth layer
- `packages/config/network.ts:12` allows binding to non-localhost via `ODE_WEB_HOST` (README even suggests `0.0.0.0`)

If this port is reachable on a LAN/VPS, anyone can read secrets or trigger bot actions.

Plan to fix it:

* not started Define an API auth model: require a shared secret (e.g. `ODE_WEB_API_TOKEN`) via `Authorization: Bearer <token>` for all `/api/*` routes; fail closed if unset when host is not localhost  
* not started Implement one auth guard middleware in `packages/core/web/app.ts` and apply it to `registerConfigRoutes`, `registerActionRoutes`, `registerSessionRoutes`, etc.  
* not started Split endpoint policy: keep static UI public if desired, but make all state-changing endpoints (`PUT /api/config`, `/api/action`) always authenticated  
* not started Add redaction in `/api/config` response for secrets unless an explicit privileged flag is present (defense in depth)  
* not started Add tests in `packages/core/test/web-routes.test.ts` for 401/403 and successful authorized requests  
* not started Update docs (`README.md`) to explain secure setup, especially when using `ODE_WEB_HOST=0.0.0.0`

If you want, I can implement this in a minimal first pass (token auth + tests) and then do a second pass for secret redaction.
```
