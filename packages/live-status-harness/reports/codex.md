# Live Status Harness Report - codex

Generated: 2026-02-25T05:17:38.758Z
Provider: codex
Working directory: /root/ode-new/.worktree/ode_1771995140.206739

- Run ID: codex_1771995494170_a46cebaf
- Source: Reused Redis stream data
- Events captured: 98
- Status updates rendered: 96

## Final Live Status Message

```text
*Codex is running...* (515k tokens, 19m 21s)
_Drafting response_

*Tool execution (Last 6 items in 34)*
- `Bash` /bin/bash -lc "sed -n '1,260p' packages/core/web/routes/action.ts"
- `Bash` /bin/bash -lc "sed -n '1,280p' packages/core/web/routes/config.ts"
- `Bash` /bin/bash -lc "sed -n '1,240p' packages/config/web.ts"
- `Bash` /bin/bash -lc "sed -n '1,260p' packages/core/web/server.ts"
- `Bash` /bin/bash -lc "grep -R \"function getWebHost\\|ODE_WEB_HOST\\|webHost\" -n packages/config packages/...
- `Bash` /bin/bash -lc "sed -n '1,200p' packages/config/network.ts"
```

## Result Message

```text
✅ done
- Read core runtime, IM adapters, and web API flow.
- One repo-wide search completed: `find . -type f` found `1013` files.
- No code edits made.

The single most important change: _add authentication to the local web API (`/api/*`)_.

Why this is highest impact:
- Sensitive endpoints are currently unauthenticated:
  - [`packages/core/web/app.ts`](/root/ode-new/.worktree/ode_1771995140.206739/packages/core/web/app.ts)
  - [`packages/core/web/routes/config.ts`](/root/ode-new/.worktree/ode_1771995140.206739/packages/core/web/routes/config.ts)
  - [`packages/core/web/routes/action.ts`](/root/ode-new/.worktree/ode_1771995140.206739/packages/core/web/routes/action.ts)
- The app explicitly supports binding to `0.0.0.0` via `ODE_WEB_HOST`, which can expose these endpoints remotely:
  - [`packages/config/network.ts`](/root/ode-new/.worktree/ode_1771995140.206739/packages/config/network.ts)

Plan to fix:
1. Add `ODE_WEB_API_TOKEN` config support (non-empty string).
2. Implement middleware in `createWebApp()` that guards `/api/*` with `Authorization: Bearer <token>` (or `X-Ode-Token`).
3. Enforce policy:
   - If host is loopback (`127.0.0.1`/`localhost`), token optional.
   - If host is non-loopback (`0.0.0.0` or public IP), token required or refuse startup.
4. Keep static UI routes public, secure only `/api/*`.
5. Update web UI client to send token header on API calls.
6. Add tests in web route tests for allowed/denied cases and startup validation behavior.
7. Update docs (`README`, `.env.example`) with secure exposure instructions.
```
