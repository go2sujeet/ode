# Ode

Ode is a agent tool that bridges your coding agents (OpenCode, Claude Code, Codex and much more) to your favorite chat apps. Perfect for personal or team developers working on the go.

![Ode demo](static/ode-demo.png)

## Highlight features

* Coding from anywhere, just chat and get response in slack.
* Map coding session 1 - 1 to slack thread, and use worktree to get isolated, parallel coding is so easy.
* Anyone in the channel can join coding without any extra setup, pay one account for all team members.
* Message live message updates, you don't wait for response without any information, you can monitor from real-time text updates.
* Per user git config, who start the thread becomes corresponding git commit author.

## Why Slack

* Slack has thread based messaging, making it easy to port to sessions in coding agents. Just focus on one thing in one thread.
* Support for message edit, markdown like text render make slack perfect to show coding related information.
* Also want to support as much chatting tools as possible.

## Setup

### Prerequisites

- Configured OpenCode / Claude Code / Codex / Kimi Code... at least 1 coding cli.
- Register a Slack Bot with Socket Mode enabled, have its APP TOKEN (xapp...) and BOT TOKEN (xbot..)
  - Configuration and auth scope can be a little bit complicated if not so familiar with slack bots. If not sure, can use /static/slack-app-manifest.json to generate from manifest file.

### Installation and Running

One-line install (macOS/Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/odefun/ode/main/scripts/install.sh | bash
```

```bash
ode 
# ODE_WEB_HOST=0.0.0.0 ode if you want to expose setting page
```

Settings UI can be accessible via http://127.0.0.1:9293 or use `/setting` command in slack like `@bot /setting`.

## Cli Support
[x] OpenCode
[x] Codex
[x] Claude Code
[x] Kimi Code
[x] Qwen Code
[x] Kilo Code
[x] Kiro Cli

## Usage

1. Invite the bot to a channel.
2. Run `@bot /setting`, select channel setting, choose your coding cli (opencode also can choose model) and working directory.
3. @ your bot with the prompt you want.
3. The bot will process your message with the coding agent.

## Worktrees

- Each slack thread uses a dedicated git worktree at `<repoRoot>/.worktree/<threadId>`
- If you don't want to use worktree, can run `@bot /setting` and select general setting, choose default.

## License

MIT
