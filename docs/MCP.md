# Use Chief of Noumenon from your own CLI

From `backend/`, run `python -m app.mcp_server`. This is a stdio MCP server
that calls the local HTTP backend. It has no database access and needs no model
API key: your MCP client supplies the model for its own session. `send_message`
queues work on the selected bot's configured engine, so that bot still needs a
ready engine. Creating task cards and reading data do not start a bot turn.

## Pair once

Keep the backend running and complete its existing owner-passphrase setup.
In Settings > Devices, create a pairing code with **Assistant (chat and tasks;
cannot approve)**. Alternatively, from the backend environment run:

```sh
python -m app.auth.cli pairing-code --scope assistant --label "CLI assistant"
```

Redeem that single-use code through `POST /api/v1/auth/pair` on the local
backend with JSON `{"code":"YOUR_CODE","label":"CLI assistant","cookie":false}`.
Save the returned `token` outside the checkout, owned by your user, with mode
`0600`. Set `CHIEF_DEVICE_TOKEN_FILE` to its absolute path, or set
`CHIEF_DEVICE_TOKEN` directly in the MCP client environment. Do not put tokens
in model prompts, command arguments, reports or client configuration checked
into git. The server rejects symlink token files and tokens with broader scopes.
Missing, invalid and revoked tokens fail before the protocol starts.

`CHIEF_BACKEND_URL` defaults to `http://127.0.0.1:8000`. Only local HTTP
addresses are accepted; redirects and environment proxies are disabled.
Revoke the device in Settings to stop its access.

## Register it

```sh
python -m app.mcp_server install
```

This prints pairing instructions and exact one-line commands using this Python
executable and checkout path. It never edits other tools' configurations or
creates an owner credential. The command shapes are:

```sh
claude mcp add --transport stdio chief -- env PYTHONPATH=/absolute/path/backend /absolute/path/backend/.venv/bin/python -m app.mcp_server
codex mcp add chief -- env PYTHONPATH=/absolute/path/backend /absolute/path/backend/.venv/bin/python -m app.mcp_server
```

Export the token-file environment variable in the client session. Flag spelling
was verified with the installed `claude mcp add --help` and
`codex mcp add --help` on 2026-11-03; other installed versions may differ.
No real CLI session or provider account was used for verification.

## Tools and authority

| Tool | Behavior |
|---|---|
| `list_bots` | List bot names, IDs and engine/model summaries |
| `send_message` | Bot name or ID, text, optional conversation ID; returns a queued turn |
| `get_conversation` | Read turns, results and current status |
| `list_conversations` | List up to 50 recent conversations |
| `search_conversations` | Bounded text search |
| `list_tasks` | Read the task board |
| `create_task` | Create a task card; does not execute it |
| `list_routines` | Read existing owner-configured routines |
| `run_routine` | Queue one existing routine with its existing permissions |
| `pending_approvals` | Read waiting approvals in a specified conversation |

There is no approval-answer tool. The backend's independent `assistant` scope
also refuses approval answers, agent/approval-mode changes, settings, credentials,
app grants and pairing administration, even if a client sends HTTP directly.
Approvals stay with the person in the app or Telegram. Text sent by an MCP client
cannot enable the runtime's owner-only configuration operations.

Outputs carry `untrusted_data` and a truncation flag. Payload text is capped at
24,000 characters and the underlying HTTP response at 1 MB. Injection text stays
data. Mutating calls are never automatically retried. After a timeout, inspect
the app before repeating an action; the backend may already have queued it.

The optional `mcp` package is not in the current lockfile. This server uses the
same newline JSON-RPC stdio pattern as the existing in-repository MCP servers,
without a new dependency. Automated tests cover protocol round trips with a fake
backend, token absence/refusal, pairing and backend scope enforcement, prohibited
tool absence, output bounds and injection-as-data. Live client interoperability
remains unqualified.

## Local Linux install

From the checkout run `bash scripts/install.sh`. It checks Node.js 22+, npm,
Python and uv; installs from the existing lockfiles; builds static UI files;
generates a private env file outside the checkout; and migrates SQLite.
Dependency installation needs network access or populated local caches. The env
file defaults to `$XDG_CONFIG_HOME/chief-of-noumenon/server.env` (or
`~/.config/chief-of-noumenon/server.env`); `CHIEF_CONFIG_DIR` overrides its folder.
Existing keys are never overwritten. The script prints a start command and does
not start or stop services. `--install-service` writes a user systemd unit;
`--enable-service` additionally enables it for future logins. Neither starts it.
Installer tests use local command stubs and temporary folders, not downloads or
a real systemd session.
