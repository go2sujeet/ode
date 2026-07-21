# GitHub Integration

This package implements Ode's GitHub adapter. It lets you `@ode` (or your configured bot name) on a GitHub issue or pull request, routes the prompt to a coding agent, and posts the agent's reply as a comment in the same thread.

## What it does

- **Webhook receiver**: listens for GitHub webhook events at `POST /api/github/webhook`.
- **@-mention routing**: when someone creates an issue/PR comment containing `@<botName>`, Ode forwards it to the configured agent for that repo.
- **Thread-aware replies**: Ode fetches existing issue comments as thread history, runs the agent, and posts the result as a new comment.
- **Status/progress**: long-running agent turns are tracked through the normal Ode runtime; the final result is posted back to GitHub.

## Supported events

| Event | Action | Behavior |
|---|---|---|
| `issue_comment` | `created` | Processed if the bot is @-mentioned. |
| `issues` | any | Parsed but currently ignored. |
| `pull_request` | any | Parsed but currently ignored. |
| `pull_request_review` | any | Parsed but currently ignored. |
| `pull_request_review_comment` | any | Parsed but currently ignored. |

## Step-by-step: configure and run

### Step 1 — Create a GitHub Personal Access Token

1. Open <https://github.com/settings/tokens>.
2. Click **Generate new token (classic)**.
3. Give it a name, e.g. `ode-bot`.
4. Select at least the **`repo`** scope (or `public_repo` if you only use public repositories).
5. Click **Generate token** and copy the token value (starts with `ghp_`).

### Step 2 — Add a GitHub workspace in Ode

#### Option A — Web UI

1. Start Ode:

   ```bash
   ode
   # or, to expose the settings page on all interfaces:
   ODE_WEB_HOST=0.0.0.0 ode
   ```

2. Open <http://127.0.0.1:9293>.
3. In the left sidebar, click **Add Workspace**.
4. Select **GitHub**.
5. Fill in:
   - **GitHub Token** — the PAT from Step 1.
   - **GitHub Webhook Secret** — any random string (save it for Step 3).
   - **Bot Name** — the username users will @-mention, e.g. `ode`.
6. Add a **Channel** for each repo you want to monitor:
   - **Channel ID** must be the repo full name, e.g. `go2sujeet/ode`.
   - Choose the **Agent** provider and **Model** for that repo.
   - Set the **Working directory** to the local clone of that repo.
   - Set the **Base branch**, e.g. `main`.
7. Click **Save** in the top-right corner.

#### Option B — CLI onboarding

Run:

```bash
ode onboard
```

Choose `github` as the workspace type and paste your token when prompted.

#### Option C — Edit `~/.config/ode/ode.json`

Add a workspace entry like this:

```json
{
  "workspaces": [
    {
      "id": "github-ode",
      "type": "github",
      "name": "GitHub (ode)",
      "domain": "github.com",
      "status": "active",
      "githubToken": "ghp_xxxxxxxxxxxxxxxxxxxx",
      "githubWebhookSecret": "my-random-secret",
      "githubBotName": "ode",
      "channelDetails": [
        {
          "id": "go2sujeet/ode",
          "name": "ode",
          "agentProvider": "opencode",
          "model": "",
          "workingDirectory": "/Users/you/Code/ode",
          "baseBranch": "main"
        }
      ]
    }
  ]
}
```

Restart Ode after editing.

### Step 3 — Configure the GitHub webhook

In the repository you want to monitor (e.g. `go2sujeet/ode`):

1. Go to **Settings → Webhooks → Add webhook**.
2. **Payload URL**: enter the URL where GitHub can reach Ode:
   - If Ode runs on a public host: `https://ode.example.com/api/github/webhook`
   - For local development, use a tunnel such as [ngrok](https://ngrok.com/) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

     ```bash
     ngrok http 9293
     # Use the generated https URL + /api/github/webhook
     ```
3. **Content type**: select `application/json`.
4. **Secret**: paste the same value you used for **GitHub Webhook Secret** in Step 2.
5. **Which events would you like to trigger this webhook?**
   - Select **Let me select individual events**.
   - Check **Issue comments**.
   - Optionally check **Issues** and **Pull requests** for future support.
6. Leave **Active** checked and click **Add webhook**.

### Step 4 — Verify the webhook is reachable

After saving the webhook, GitHub shows a delivery history. Click the most recent delivery:

- You should see a `200 OK` response.
- If no one mentioned the bot yet, the response body contains something like:

  ```json
  { "ok": true, "result": { "action": "ignored", "reason": "bot_not_mentioned" } }
  ```

That is expected — it means Ode received and verified the webhook.

You can also test with curl:

```bash
curl -X POST https://<your-ode-host>/api/github/webhook \
  -H "content-type: application/json" \
  -H "x-github-event: issue_comment" \
  -H "x-hub-signature-256: sha256=<valid-signature>" \
  -d '{"action":"created",...}'
```

### Step 5 — Mention the bot

Create a comment on an issue or PR in the monitored repo:

```text
@ode please review this PR and suggest improvements
```

Ode will:

1. Verify the webhook signature.
2. Parse the repo and issue number.
3. Load the matching channel config.
4. Fetch prior comments as context.
5. Run the configured agent.
6. Post the agent's reply as a new comment in the same issue/PR thread.

### Step 6 — Check Ode logs if something goes wrong

```bash
ode log --tail 50
ode log --error --tail 50
```

Common issues:

| Symptom | Fix |
|---|---|
| Webhook returns `401` / `signature_mismatch` | Make sure the webhook secret in GitHub matches `githubWebhookSecret` exactly. |
| Webhook returns `ignored: no_workspace_for_repo` | Add the repo as a channel with id `owner/repo` in the GitHub workspace. |
| Webhook returns `ignored: bot_not_mentioned` | The comment must contain `@<botName>`. |
| No reply posted | Check `ode log --error`; verify the PAT has `repo` scope and is not expired. |

## CLI

You can post a comment manually without triggering the agent:

```bash
ode send github-comment --repo go2sujeet/ode --issue 6 --message "Ship it!"
```

The repo must be configured as a GitHub workspace channel first.

## Architecture

```text
GitHub webhook
      │
      ▼
/api/github/webhook  ──►  processWebhookPayload()
                              │
                              ▼
                        verify signature, parse repo/issue
                              │
                              ▼
                        create RawInboundEvent (platform: "github")
                              │
                              ▼
                        handleGitHubWebhookEvent()
                              │
                              ▼
                        createCoreRuntime({ platform: "github", im: githubAdapter })
                              │
                              ▼
                        agent runs with thread history + issue title
                              │
                              ▼
                        im.sendMessage() ──► GitHub issues/comments API
```

Key files:

- `client.ts` — runtime startup, adapter factory, token resolution.
- `webhook.ts` — signature verification, payload parsing, event filtering.
- `utils.ts` — GitHub REST API helpers (`createComment`, `updateComment`, `getIssueComments`, etc.).
- `../../core/web/routes/github-webhook.ts` — HTTP route wiring.

## Security

- Webhook signatures are verified with `timingSafeEqual` against every configured GitHub workspace secret.
- The integration uses the token supplied in the workspace config; it does not read `GH_TOKEN` or other ambient credentials.
- Bot comments are skipped if the comment author matches `github-actions[bot]` or the configured bot name.

## Current limitations

- Only **Personal Access Token (PAT)** auth is implemented. The config schema reserves `githubAppId`, `githubPrivateKey`, and `githubInstallationId` for GitHub App support, but they are not yet used.
- Only `issue_comment.created` with an @-mention triggers the agent. Other webhook events are accepted and parsed but ignored.
- Mapping GitHub activity into Slack/Discord/Lark channels is not implemented.
- There are no automated tests for the GitHub adapter yet.
