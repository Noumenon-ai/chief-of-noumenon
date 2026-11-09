# Chief of Noumenon

Chief of Noumenon is a self-hosted website for talking to bots, giving them files
and jobs, reviewing actions, and running reminders and routines. You run it on
your computer and choose its model provider. This fork has no hosted service.

Use **Settings → Use on your phone** to open the same website privately on your
phone and add it to your home screen. [Phone setup](docs/PHONE.md) uses Tailscale
and a one-time sign-in code, so you do not type a long passphrase on your phone.

[Telegram alerts](docs/TELEGRAM.md) are optional: approvals, hand-offs, reminders,
briefs and urgent mail. Chat happens in the website.

Built from [Open Duet](https://github.com/Anil-matcha/open-duet), with credit to
its authors. The [Apache-2.0 license](LICENSE) and [NOTICE](NOTICE) apply.

## Quick start

On Linux, install Node.js 22+, npm, Python 3, [uv](https://docs.astral.sh/uv/)
and bubblewrap. From this checkout:

```sh
bash scripts/install.sh
"${XDG_CONFIG_HOME:-$HOME/.config}/chief-of-noumenon/start.sh"
```

Open `http://127.0.0.1:8000`, set your owner passphrase, and follow the engine
setup. Choose a signed-in Claude Code or Codex CLI, an API key, or a local model
such as Ollama or LM Studio. Then open **Settings → Use on your phone** if wanted.
If you set `CHIEF_CONFIG_DIR`, use the start command printed by the installer.

Installation downloads dependencies and keeps the website and API together.
For engine requirements, service management and backups, see
[self-hosting](docs/SELF-HOSTING.md) and [setup](docs/SETUP.md).

## What works, and what needs proof

Bots have named workspaces, conversations, memory and selected skills. They can
use connected apps, delegate work, run routines and request approval for
changes. Ask first, Accept edits and Plan only govern workspace tools; connected
app writes require approval. Shell and internet access can still disclose any
workspace data the bot can read. See [security](docs/SECURITY.md).

On 2026-11-04, live Linux checks showed that Claude Code and Codex could not
read a planted login-folder file through shell, file tools or path traversal,
while normal workspace work still ran. This proves those tools on those tested
versions, not every future engine version. See [the recorded proof](docs/PROVEN_APPS.md).

The local connector registers **268 providers and 8,546 actions** in
`connector/server/app/providers/registry.py`. These are catalog entries, not
8,546 proven operations. Most providers have not been tested on live accounts.
See the precise [live proof list](docs/PROVEN_APPS.md). X posting requires your
own API credits. Optional Composio, community MCP tools and computer providers
have separate setup and data flows.

This is an experimental single-owner app. Desktop, mobile, browser control,
engine compatibility and third-party integrations have different verification
levels. No external write should be retried automatically after an unknown
result. Real-account proof cannot be replaced by fake-server tests.

## Guides

- [Engines](docs/ENGINES.md), [connected apps](docs/CONNECTED_APPS.md),
  [Telegram](docs/TELEGRAM.md), [teams](docs/TEAMS.md)
- [Memory](docs/MEMORY.md), [skills](docs/SKILLS.md), [routines](docs/ROUTINES.md)
- [Data map](docs/DATA_MAP.md), [privacy template](docs/PRIVACY.md),
  [security and reporting](docs/SECURITY.md)
- [Contributing](docs/CONTRIBUTING.md), [changelog](CHANGELOG.md)
