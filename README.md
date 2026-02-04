# Ode

Ode is a Slack bot that bridges chat messages to OpenCode, enabling AI-assisted coding directly from Slack channels.

## Features

- **Slack Socket Mode**: Secure real-time messaging without webhooks
- **OpenCode Integration**: Execute AI coding tasks via OpenCode's HTTP API
- **Per-Channel Agents.md**: Custom system instructions per Slack channel
- **Thread Tracking**: Maintains context within conversation threads
- **Local Settings UI**: Web interface to manage Ode config in local mode

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- OpenCode installed and in PATH
- Slack App with Socket Mode enabled

### Installation

One-line install (macOS/Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/odefun/ode/main/scripts/install.sh | bash
```

Upgrade:

```bash
ode upgrade
```

### Configuration

Copy `.env.example` to `.env` and fill in your Slack credentials:

```bash
cp .env.example .env
```

Optional:
- `ODE_SLACK_API_HOST` - Slack action API host (default: 127.0.0.1)
- `ODE_SLACK_API_PORT` - Slack action API port (default: 9292)
- `ODE_WEB_HOST` - Settings UI host (default: 127.0.0.1)
- `ODE_WEB_PORT` - Settings UI port (default: 9293)
- `ODE_REDIS_ENABLED` - Enable session inspector storage in local mode (default: false)
- `REDIS_HOST` - Redis host for session inspector (default: localhost)
- `REDIS_PORT` - Redis port for session inspector (default: 6379)

Local settings UI:
- Start the app in local mode and open `http://127.0.0.1:9293/local-setting`
- Changes are saved to `~/.config/ode/ode.json`

## Running

Local mode (starts the settings UI automatically):

```bash
ode
```

Settings UI:

```
http://127.0.0.1:9293/local-setting
```

## Usage

1. Invite the bot to a channel
2. Mention the bot or reply in an active thread
3. The bot will process your message with OpenCode and reply

## Local Settings UI

The local settings UI exposes `http://<ODE_WEB_HOST>:<ODE_WEB_PORT>/local-setting` and lets you edit:
- OpenCode server list and models
- Slack workspace tokens and channels
- Per-channel model + dev server selection
- Working directory per channel

## License

MIT
