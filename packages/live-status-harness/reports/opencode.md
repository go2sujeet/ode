# Live Status Harness Report - opencode

Generated: 2026-02-22T11:06:45.423Z
Provider: opencode
Working directory: /root/ode-new/.worktree/ode_1771752635.512539

- Run ID: opencode_1771756700380_e8233afa
- Events captured: 866
- Status updates rendered: 146

## Final Live Status Message

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

## Result Message

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
