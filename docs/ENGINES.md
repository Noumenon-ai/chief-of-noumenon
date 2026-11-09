# Engines

Chief of Noumenon runs a conversation's turns on an **engine**: the program or service
that writes the answer and, for some engines, runs tools. Every engine sits
behind one adapter contract, so the thread runtime, approvals, events and the
UI do not know which engine they are talking to.

| Engine id | Label | Kind | What it drives |
|---|---|---|---|
| `claude` | Claude | cli | your own `claude` CLI (stream-json both ways) |
| `codex` | Codex | cli | your own `codex` CLI over `codex app-server` (JSON-RPC on stdio) |
| `gemini` | Gemini CLI | acp | Gemini CLI with engine-scoped credentials and model selection |
| `antigravity` | Google Gemini (Antigravity) | acp | official managed Google runtime, isolated personal account OAuth and account model catalog |
| `cursor` | Cursor | acp | Cursor CLI, with a live model catalog |
| `opencode` | OpenCode (experimental, opt-in) | acp | OpenCode CLI; real permission override proof pending |
| `acp` | ACP agent | acp | any agent CLI that speaks the Agent Client Protocol, from a saved command |
| `openai_compat` | OpenAI-compatible | api | `POST {base_url}/chat/completions`, streamed (Ollama, LM Studio, vLLM, hosted APIs) |
| `openrouter` | OpenRouter | api | the OpenAI-compatible engine preset for `https://openrouter.ai/api/v1` |

## Choose and configure an engine

Open **Settings → Engines** in the web UI or desktop app. **Check again**
checks installation, login and endpoint readiness. An unavailable engine shows
its reason without blocking the others. Claude and Codex sign-in happen in their own terminal flows. Install Codex from OpenAI, run `codex login`, then press Refresh. Antigravity has its own install
and Google sign-in controls below.

For Claude and Codex, **Sign out** asks for confirmation before running the
installed CLI's logout command. It affects the server's shared CLI account,
including CLI use outside this app. Stop all active conversations first:
account removal refuses running or starting turns, and new turns refuse while
sign-out is pending. Pending sign-in also blocks sign-out for the same account
folder. The CLI must confirm that it is signed out; an environment API key can
keep it connected and cause an unconfirmed result. No raw CLI output is shown.

To switch accounts, sign out explicitly, then sign in again in the CLI terminal.
There is one shared account per CLI, with no named-account selector. Existing
provider sessions may need a new conversation after changing accounts. Real
account switching, Windows and installed-app behavior have not been qualified.

For ACP, save the command and optional display name. For an OpenAI-compatible
endpoint, save its base URL (including `/v1` when required), optional default
model and optional API key. Configuration is encrypted at rest. A blank key
keeps the saved key for the same URL; changing the URL drops it unless you
enter a key again. **Forget settings** deletes the configuration and credential.
For OpenRouter, save an API key. The address is fixed to OpenRouter over HTTPS; configure a proxy with the generic OpenAI-compatible engine.


Settings forms come from each adapter's `config_fields` and `setup` descriptors.
Ready engines appear before engines that need setup, including in engine pickers.
Connection commands for other engines are displayed for the person to run.
Under the generic endpoint card, **Fill address from template** supplies
an address for Ollama, LM Studio, Groq, Cerebras, Mistral or OpenAI. It supplies
no key or model. These services have not been checked with real accounts.

### Google account models through Antigravity

In **Settings → Engines → Google Gemini (Antigravity)**, select **Install
Antigravity**, then **Sign in with Google**, then **Continue to Google sign-in**.
The installer downloads Google's official ACP runtime 1.4.3, checks the pinned
SHA-256 from the [ACP registry](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json),
rejects unexpected archive members, and validates its ACP identity before
publishing the install. macOS and Linux on Intel and ARM64 are supported;
Windows support is deferred. The installer checks the actual archive size and
expanded size against available free space before unpacking.

Sign in with an eligible personal Google account. This connection does not use
Gemini API keys or Enterprise authentication. Google's [authentication guide](https://www.antigravity.google/docs/install?tab=cli)
describes the available account routes; [model availability](https://www.antigravity.google/docs/models/)
depends on the account's plan. Chief of Noumenon discovers the account's models after
sign-in. **Refresh models** reloads them; **Check again** reads the saved
catalog without starting another OAuth flow. Select Antigravity and one of
these models in the normal chat or agent picker. Unsupported model IDs fail
before a prompt is sent. The advanced default model must be in this catalog.

One Google account is connected at a time. **Switch Google account** prepares
a new isolated profile and replaces the old one only after successful sign-in
and model discovery. **Remove Google account** deletes the app's profile and
credentials; it does not revoke the grant at Google. Existing native sessions
cannot resume under a replacement account: start a new session. When the app
runs on another computer, use the sign-in card's redirect URL field to forward
the complete localhost redirect back to the server. The callback must match
the pending loopback port and OAuth state. Pending sign-in can be cancelled
and expires after five minutes of waiting for authentication.

Runtime files and UUID account profiles live under `antigravity/` next to the
configured SQLite path (also on PostgreSQL). The official runtime manages its
refresh credentials in the private profile's `antigravity-acp/acp_token.json`;
the profile reference and default model use the encrypted engine configuration.
`GEMINI_HOME` and forced file storage isolate it from the IDE and global Gemini
login. Google API keys, ADC/project configuration and provider overrides are
removed from the child environment. OAuth URLs stay in pending setup memory;
native stderr is discarded and callback codes are excluded from request logs.

Every new or resumed session must confirm `mode=default` before a prompt.
Chief of Noumenon handles the resulting permission requests, including plan-mode
denials and workspace-limited accept-edits. Native sessions resume through
`session/resume`; Stop sends `session/cancel`. Images, agent computers and
Enterprise sign-in are not enabled for this engine.

Verification on 2026-10-25: synthetic process and API tests cover installation
integrity checks, account isolation/switch/removal, callback validation,
discovery, model and approval-mode confirmation, permission handling, Stop,
and resume. The official macOS ARM64 1.4.3 archive passed SHA-256 validation,
ACP initialization, and OAuth URL startup in a temporary profile. A completed
real-account sign-in, refresh, model prompt, approval and restart/resume run
is still required before claiming end-to-end account compatibility. Other
platform assets are pinned from the registry but have not been executed here.

Choose an engine and model in the Agents panel or before sending a new chat.
The model field offers catalog suggestions and accepts a custom ID only when
the engine supports it. The generic ACP engine uses its CLI's configured model;
its picker exposes only the agent default. A computer attached to an agent
requires a computer-capable engine (Claude, or Codex for Docker computers).

An existing conversation keeps its engine. Its header lets you change the
model while idle. An explicit thread model overrides the agent; an unset one
follows the agent's model only while they share a provider, otherwise it uses
the engine default. Changing an agent's engine affects new conversations.

## The contract

The capability table describes adapter interfaces; Codex protected turns require
the installed CLI to pass the native sandbox preflight and profile checks described below.

`backend/app/services/provider_adapter.py`. An adapter has:

- `key`, `label`, `kind` (`cli`, `acp`, `api`).
- `capabilities`: flags the runtime reads instead of engine names; the API exposes
  the six public flags below other than the internal `memory_tools` flag.

  | Flag | Meaning |
  |---|---|
  | `tools` | can run tools (commands, file edits) in the workspace |
  | `approvals` | its tool calls go through the approval gate |
  | `mcp` | can mount an MCP server this app gives it |
  | `memory_tools` | mounts only the read-only past-conversation search ([MEMORY.md](MEMORY.md)); ACP agents set this without `mcp`; Claude and Codex also mount team tools through `mcp` |
  | `images` | accepts images attached to a message ([EVERYDAY.md](EVERYDAY.md)); an image for any other engine is refused with `images_unsupported` |
  | `resume` | a conversation continues with the engine's earlier context |
  | `computers` | its turns can run their tools in an agent computer |

- `models` (static catalog), `custom_models` (any id accepted), and `probe()`,
  which may also return a live catalog.
- `new_session_id()`, `status()`, `run_turn(ctx, sink, gate)`: the turn API the
  runtime already used. A turn reports normalized events (`assistant.message`,
  `tool.started`, `tool.completed`, typing deltas) through the sink, asks a
  person through the gate, and returns a `TurnOutcome`, which may now carry
  `provider_state` (the engine's own conversation id, never a secret).
- For an engine with a saved configuration: `needs_config`,
  `validate_config(payload, current)` and `public_config(config)` (never a
  secret).

Every one of these except the turn API is optional; the registry fills in safe
defaults (no capabilities, any model, a probe derived from `status()`).

|  | Claude | Codex | ACP agent | OpenAI-compatible (and OpenRouter) |
|---|---|---|---|---|
| tools | yes | yes | yes | structured function calls |
| approvals | yes | yes | yes | shared durable gate |
| mcp | yes (team, memory and computer servers) | yes (team, memory and Docker computer servers) | read-only history search only | team, memory, connected apps |
| images | yes (stream-json content blocks) | no | no | image URLs, when supported by the model |
| resume | `--resume` | `thread/resume` | `session/load`, or the transcript as text | stored history each turn |
| computers | yes | yes (Docker computers) | no | no |

## The registry

`backend/app/services/engine_registry.py`, `GET /api/v1/engines`.

- Built from the runtime's adapters. An adapter that cannot be constructed is
  kept as an unavailable engine with the reason; the rest still load.
- Nothing is probed at startup. A probe runs when someone asks for the
  engines, is bounded (12 s overall, 5 to 8 s per CLI call) and kills the
  process group of a CLI that does not answer. A probe that raises or hangs
  reports `available: false` with a reason; the request never fails.
- Results are kept for 15 s; `?refresh=true` checks again.
- Each entry: `id`, `label`, `kind`, `installed`, `version`, `signed_in`,
  `available`, `reason`, `models` (with `default`), `default_model`,
  `custom_models`, `capabilities`, `configurable`, `config` (no secrets).
- Probes read one fact from CLI output (`codex login status` prints the
  account; only "Logged in" / "Not logged in" is read) and never log it.

## Validation

- Agents (`POST`/`PATCH /api/v1/agents`) and threads (`POST /api/v1/threads`,
  `PATCH` with `model`) must name a registered engine (`unknown_provider`) and
  a model it accepts (`unknown_model`). A model id is one token (letters,
  digits, `. _ : / @ + - [ ]`, not starting with `-`); engines with
  `custom_models: false` (the ACP agent) take only their catalog.
- An agent can change engine. Its conversations keep the engine they started
  on; an agent's model applies only to conversations on the agent's engine.
- Computers need an engine with the `computers` flag (Claude, and Codex for
  Docker computers): `POST /agents/{id}/computer` answers 409
  `engine_without_computers` for an engine without the flag, moving an agent
  with a computer to such an engine is refused the same way, and a turn that
  still meets this combination fails with that code.

## Claude sign-in

Install Claude Code from Anthropic, run `claude` in a terminal, and sign in
there. Then press **Refresh** in Settings. The app detects the signed-in CLI
using its status command. It never reads or copies Claude credential files.
API key configuration remains available.

## Claude workspace tool boundary

Claude starts with `--tools ""`, `--strict-mcp-config`, `--restricted`,
`--disable-slash-commands` and `--settings '{"disableAllHooks":true}'`.
Local installed `claude --help` confirms the empty tool list disables all
built-in tools, including WebFetch. The restricted mode ignores user/project
settings. Unsupported flags fail launch; there is no unrestricted retry.

The engine box retains the official CLI login folder for inference and refresh,
but its working directory is an empty, read-only mount at the normal workspace
path. It cannot load a model-written context symlink or project hook. A scoped
`workspace` MCP mailbox offers read, write, edit, glob, grep and shell. The backend
opens the same durable gate used by API engines for each actual invocation.
This protects against forged mailbox requests; shim permission alone is not
execution permission. Ask uses cards for workspace file operations and shell
(subject to saved command rules). Reads are automatic in Accept edits and Plan;
Accept edits permits scoped edits, and Plan denies mutation.
Receipts retain plain workspace labels through the existing `api__` tool names.

Operations execute in a second bubblewrap box with the real workspace, a
synthetic empty home, no CLI login mounts or provider-key environment, and no
operator-added runtime/login grants. No shell fallback is allowed for this
bridge. Memory/history, selected skills, team tools and connected-app mailboxes
remain supplied by the backend. Native CLI slash-command skills stay disabled.
Computers keep their existing separate backend bridge and approval rules.

The engine itself is trusted and still can read and refresh its login. Standard
runtimes, workspace contents and approved tool results remain visible to tools;
public network access can disclose anything readable. A compromised engine or
host is outside this boundary. With Linux isolation disabled, this is not a
credential-isolation claim. Legacy local-task callers do not acquire workspace
tools merely by requesting native tools; use agent conversations.

The real scripted-engine canary test is
`tests/core/test_turn_sandbox.py::test_real_split_engine_and_workspace_canary`.
It must pass on a namespace-enabled Linux host before release; mount argv tests
are not a substitute. Provider compatibility with these flags also needs host
qualification using the person's own installation.

## Codex

Install Codex from OpenAI, run `codex login` in a terminal, then press Refresh.
Detection uses the official CLI status command; the app does not read or display
`auth.json` contents. There are no in-app device-code routes or callers. API key
entry through API engines remains available. Sign-out still invokes the official
CLI with the existing account-operation serialization.

On Linux with turn sandbox protection enabled, the Codex process itself is
trusted and holds its login. `codex app-server` runs outside our turn box.
Its commands run in Codex's own sandbox with the login denied. Claude's split
engine/workspace design is unchanged. This does not claim that Codex's native
execution tools can be disabled: 0.166.0 ignores `features.unified_exec=false`.

Each app-server gets these separate `-c` overrides:

- `default_permissions="con"`
- `permissions={con={filesystem={":root"="deny",":minimal"="read",<runtime paths>="read",":workspace_roots"={"."="write"}},network={enabled=true}}}`
- `mcp_servers={}`, `web_search="disabled"`, `approvals_reviewer="user"`
- `features.apps=false`, `features.plugins=false`, `features.remote_plugin=false`,
  `features.plugin_discovery_prefetch=false`, `features.hooks=false`
- `features.skip_host_skill_discovery=true`, `features.tool_call_mcp_elicitation=true`
- `features.multi_agent=false`, `features.multi_agent_v2=false`, `features.shell_snapshot=false`

Runtime paths come from the turn sandbox's executable discovery: the resolved
executable, symlink aliases, package and optional platform packages, interpreter
and install prefix. System reads cover existing `/usr`, `/bin`, `/sbin`, `/lib`,
`/lib64`, `/etc/ld.so.cache`, `/etc/ssl`, `/etc/localtime`, `/etc/passwd`,
`/etc/group`, and `/etc/nsswitch.conf`. With network enabled, `/etc/hosts`,
`/etc/resolv.conf` and its resolved target (including the exact systemd resolver
file) are also readable. No whole home, CODEX_HOME, application data, connector
data or computer state is granted. Unsafe overlaps refuse startup. Owner-added
turn-box path grants are not imported.

Plan, tools-off and computer turns use `"."="read"`. When the optional turn
HTTP egress gate is enabled, native command networking is disabled
(`network={enabled=false}`), because the unboxed app-server cannot use that
outer gate for its commands. App-owned backend bridges keep their existing
network controls. Otherwise command networking is enabled; DNS resolver access
is included, but connectivity still depends on the host.

Before every engine turn start, the app checks the installed version and obtains
a preflight result cached by executable identity/version, workspace identity,
login location and exact overrides. On a cache miss it creates a private random
canary in CODEX_HOME, runs `codex sandbox` with those same overrides, and requires
both failed canary read and successful workspace read/write (failed write in
read-only mode). The app removes its canary and probe files even on failure or
cancellation. It never reads real credentials. Failure refuses the turn with a
plain error and no unprotected retry. Status probing no longer rejects Codex
because native-tool disable switches are ineffective.

Locally inspected 0.166.0 help confirms `-c KEY=VALUE` overrides user config and
uses TOML values, `codex sandbox -- <command>` selects the native sandbox, and
`features list` advertises the extension switches above; a local run with these
overrides confirmed all ten requested feature values. The generated
experimental app-server JSON schema describes `permissions` as the named
profile selector, mutually exclusive with the legacy sandbox fields. Protected
RPC calls send exactly these permission-related fields:

- `thread/start` and `thread/resume`: `cwd`, `permissions: "con"`,
  `runtimeWorkspaceRoots: [<agent workspace>]`, `approvalPolicy: "untrusted"`,
  `approvalsReviewer: "user"`. Resume also sends `threadId`.
- `turn/start`: `threadId`, prompt `input`, `permissions: "con"`,
  `runtimeWorkspaceRoots: [<agent workspace>]`, `approvalPolicy: "untrusted"`,
  `approvalsReviewer: "user"`.

Model, effort and developer instructions remain as applicable. Thread `config`
repeats the extension flags and disabled web search, disables any inherited MCP
names reported by `config/read`, and attaches only this app's turn servers.
Neither `sandbox` nor `sandboxPolicy` is sent. Ordinary turns omit `environments`;
computer turns retain `environments: []`. The thread response must confirm the
`con` profile without inheritance, the pinned roots, untrusted approvals and the
user reviewer before any prompt is sent. A fresh app-server per turn and explicit
profile selection on start/resume/turn avoid depending on persisted first-prompt
state. A subfolder workspace is probed as that exact working directory.

User MCP servers, plugins, apps and hooks are disabled through startup overrides;
the user's config is not edited. The app-owned MCP shims run beside the engine,
not inside a nested turn box, and their launch descriptors contain no credentials.
Backend mailbox handlers retain connected-app credentials and approval authority.
The trusted engine can still access its own login; these shims are not an OS
boundary against a compromised engine or malicious shim implementation.

Native workspace patch requests follow the existing cards: ask requests a card,
accept-edits permits workspace edits, and plan/tools-off refuse mutations. Paths
outside the workspace, unknown paths, symlink escapes, rename destinations outside
it and every grant-root request are refused without a card in every mode.
Permission-expansion requests receive no grants. Command requests retain the
existing gate and saved rules, but explicit extra permissions/network escalation
are refused. Known-safe commands may run without cards under Codex's untrusted
policy. Item-start events may precede approval; they are not violations. Successful
unapproved patches or completion after denial stop and kill the engine. This is a
regression detector and cannot undo an already executed operation.

The boundary depends on the trusted CLI honoring its named profile for all native
commands and requesting approval for patches. It does not protect the CLI's own
login from the CLI, cover future tools that read internal engine state, constrain
all engine-level reads, provide data-loss prevention, or isolate secrets placed in
the workspace, prompt, engine environment or attachments. Neither a cached native
sandbox probe nor protocol tests prove every app-server execution path. Dispatcher
live proof must cover allowed and denied commands, safe commands without approval,
patches, plan, second turns/resumes, subfolder starts, DNS and user extension
exclusion. Record version and results in [PROVEN_APPS.md](PROVEN_APPS.md).

Non-Linux and explicitly unprotected turns retain their legacy behavior; they do
not provide this login-denial boundary. Do not disable protection to qualify a
failed protected installation. No authenticated Codex turn was run for this job.

## ACP agent

One process per turn from the saved command (split like a shell, never run
through one): `initialize` (file system and terminal advertised as off),
`session/new` with no MCP servers (an agent with notes on gets the one read-only memory-search server, see [MEMORY.md](MEMORY.md)), or `session/load` when the agent can load
sessions, then `session/prompt`. An agent that cannot load sessions gets the
conversation so far as text. `session/request_permission` goes through the
gate; only an `allow_once` option approves (never `allow_always`), Deny picks
`reject_once`, and plan or tools-off refuse without a card. Stop sends
`session/cancel`, then kills. Model choice stays inside the agent.

## OpenAI-compatible endpoint

Structured function calling with streamed text. `base_url`, optional default `model` and optional key are saved
encrypted (one `user_credential` row, `engine:openai_compat`). The key is sent
only as `Authorization: Bearer` to that address, is kept for the same address
only, and is never returned, logged or stored in events or the decision log;
endpoint errors have it removed. Each turn sends the stored history (newest
kept, 120,000 characters) with the agent's instructions as the system message.

## OpenRouter

A preset of the OpenAI-compatible engine (`OpenRouterAdapter` in
`backend/app/services/openai_chat_adapter.py`), registered as its own engine
`openrouter` with its own saved configuration (`engine:openrouter`), so it can
be set up beside a local endpoint. Everything above applies, with these
differences:

- The address is fixed to `https://openrouter.ai/api/v1`. Configuration requests
  containing `base_url` are rejected. Use the OpenAI-compatible engine for a
  proxy. Older saved proxy configurations must be saved there again; they are
  refused without sending the key to that proxy.
- A key is required. Readiness authenticates through `GET /key`, independently
  of the public model catalog. A rejected key reports signed out. A failed or
  malformed key check reports unavailable without displaying its body.
- Model ids use `vendor/model` with an optional variant such as `:free`.
  Refresh lists up to 600 models from `GET /models`, labels free models, and
  puts free models supporting tools first.
  A free-tier key with no chosen model uses the first available free model.
  Other keys require a chosen model; the app does not select a paid model.
- Requests to openrouter.ai also carry OpenRouter's optional app-attribution
  headers, `HTTP-Referer: https://github.com/Anil-matcha/open-duet` and
  `X-Title: Chief of Noumenon`. They tell OpenRouter that this account's traffic comes
  from Chief of Noumenon (OpenRouter uses them for its public app rankings), and they
  are sent only to openrouter.ai.
- Uses the same tools, approvals and image protocol as OpenAI-compatible endpoints;
  agent computers remain unavailable. HTTP 402 is a credit limit. A `free-models-per-day` refusal is a
  usage limit; a general 429 is a rate limit. No reset time is guessed.

Tested against a mock endpoint only; no turn has been run against the real
OpenRouter service yet.

## Limits and the fallback engine

When an engine refuses a turn for a usage limit, a rate limit or a lack of
credits, the runtime recognises it for every engine
(`backend/app/services/engine_errors.py`): Claude's usage-limit words and its
refusing `rate_limit_event` (with the reset time it reports), Codex's rate and
usage limits, and an OpenAI-compatible endpoint's 429 or
`insufficient_quota`. Only failures the engine itself reported are read, never
a timeout or a crash. The turn fails with `error_code` `engine_limited` and a
plain message that says when the limit resets when the engine said so.
Claude's API-error frames are no longer stored as if they were the answer.

The engine is then marked limited in this backend's memory: `GET
/api/v1/engines` returns `limit` (`kind` usage_limit, rate_limit or credits,
`resets_at`, `since`, `message`) until the reset time, a minute for a rate
limit that named none, or until a turn on that engine succeeds. The engine
picker shows a chip ("Usage limit · resets in 2h 5m") and the message.

An agent may name a **fallback engine** and model (`fallback_provider`,
`fallback_model` on `POST/PATCH /api/v1/agents`, or **Fallback engine when
limited** in the Agents panel; it must be another engine than the agent's own,
422 `invalid_fallback` otherwise). A turn moves to it only when all of these
hold:

- the engine refused the turn **before accepting it**: no output, no tool
  call, no approval question and no typing had come from it. A limit hit after
  the engine started is never moved (it may have run tools); the message says
  so;
- the fallback covers what the turn needs: tools and approvals when the turn
  has tools (an engine with tools but no approval gate would run them
  unasked), images when the message has any, an agent computer when the agent
  has one, and, for a conversation that already has messages, the earlier
  messages: only an engine that replays the stored transcript (OpenAI-compatible)
  can take a continuing conversation, since no engine can resume another
  engine's session;
- the fallback is ready, accepts the model, and is not limited itself.

Then the transcript gets an `engine.switched` event (from, to, model, reason,
reset time, and the message "Switched this turn to X because Y refused it
before starting: ...") shown as its own notice, and the same turn runs on the
fallback. The conversation stays on its own engine: the fallback's session and
state are not kept, so the next message tries the conversation's engine again.
For an engine with a native session, that next message includes the missing
fallback exchanges as explicitly framed historical records, including partial
output and tool records from failed fallback turns. This handoff is derived
from the stored transcript and survives a backend restart. It grants no new
permission and does not rerun a turn. A successful turn on the original engine
consumes the handoff; an explicit session reset discards it. Records over
24,000 characters use a bounded excerpt summary; the full transcript stays
stored. A replaying fallback uses its own context budget and token estimate.
When a switching condition fails, the turn fails with `engine_limited`, the reason the fallback could
not take it, and the next step. There is never a silent switch, and a limit is
never retried on the same engine.

Limits are per backend process (a restart forgets them until the next refusal).

## Not built yet

- Presets for other services (Gemini, OpenCode, Cursor); OpenRouter is the
  only preset so far.
- Several instances of one engine (two ACP agents, two endpoints), per-engine
  icons, installing or signing in to an engine from the app.
- Moving a continuing conversation to a session engine (Claude, Codex) when its
  own engine is limited; a fallback chain of more than one engine; usage-limit
  meters read ahead of a refusal.
- Model prices, context windows and usage-limit meters.
- Images (attached text files work everywhere), team-tool MCP servers for engines other than Claude and Codex, and computers for engines other than Claude and Codex (Codex mounts team tools, the computer's tools and the read-only memory search; ACP agents get only the memory search).
- A long-lived engine process across turns (each turn starts one).


## ACP preset engines

Gemini CLI (`gemini`) and Cursor (`cursor`) use the same ACP transport, approval gate, workspace, transcript replay, resume and Stop handling as the custom ACP engine. Install and sign-in advice appears in Settings → Engines. Program overrides contain the program only (for example `npx -y @google/gemini-cli`); the preset adds the ACP arguments itself. Optional saved keys are encrypted, write-only, and injected only into that engine's process. The engine's own shell commands can read those keys.

- **Gemini CLI:** install `npm install -g @google/gemini-cli`, run `gemini` to sign in or save an API key. Starts with `--acp --approval-mode default`, plus `-m` for a selected model. Existing refreshable Google login files and API keys are detected locally. Vertex configuration must be opted in through `OPEN_DOTS_ENGINE_ENV`; consumer login availability depends on Google's current policy. Static model suggestions accept custom IDs.
- **Cursor:** install from [Cursor's CLI documentation](https://cursor.com/docs/cli), then `cursor-agent login` or save a key. Starts with `cursor-agent acp`, without automatic approval flags. Credentials suppress ACP browser authentication. Status and model discovery use bounded CLI commands. A selected model must be offered by the session and accepted by `session/set_model`; refusal ends the turn before the prompt. Cursor's `cursor/ask_question` extension is answered as unsupported, so it cannot hang waiting for a question card.
- **OpenCode (experimental):** install `npm install -g opencode-ai` and run `opencode auth login`. Discovery uses `opencode models` without creating a session. A model must be offered by the session's configuration and confirmed by `session/set_config_option`. Additional saved provider-key maps are not implemented. OpenCode strips ambient foreign API keys and configuration overrides, pins project configuration off, and supplies `OPENCODE_PERMISSION` asking for every tool (edit/bash denied in plan mode, all tools denied when tools are off). This override has **not** been proven against hostile real CLI configuration; OpenCode is disabled by default.

`OPEN_DOTS_PRESET_ENGINES` selects enabled presets by comma-separated ID. Unset enables `gemini,cursor,openrouter,antigravity`. An empty value disables all presets; add `opencode` to also enable experimental OpenCode. Include `antigravity` when setting an explicit list to show Google account setup. Custom ACP and OpenAI-compatible engines are always registered. Preset CLIs are not supported on Windows yet.

For ask and accept-edits modes, Gemini always uses `--approval-mode default`, Cursor receives no automatic approval flag, and OpenCode receives ask rules. Every permission request uses the existing approval gate; accept-edits only auto-allows edits whose listed locations all lie inside the workspace. Plan mode and tools-off refuse permission requests. A vendor's own configuration can allow tools without sending a request, especially Cursor allow rules; these presets do not provide a filesystem sandbox. Review CLI configuration before enabling tools.

`engine_signed_out` means connect the engine in Settings or run the sign-in command shown there. This is a credential failure, not a usage limit, and does not trigger limit fallback. `engine_model_unavailable` means the selected model could not be confirmed; no prompt was sent. Session resume is used only when advertised; otherwise stored history is included in the new prompt.

### Preset verification record (2026-10-23)

| Engine | Checked | Not checked |
|---|---|---|
| Gemini CLI | Synthetic ACP authentication, argv, model reporting and local credential fixtures; installed 0.34.0 distribution source inspected for auth methods and flags | Real signed-in turn, real permission requests, quota messages and resume |
| Cursor | Synthetic status/models discovery, credential isolation, model selection/refusal, generic ACP lifecycle regression tests | Real CLI/account, exact live model IDs, question behavior, permission bypass from user configuration |
| OpenCode | Synthetic model discovery without sessions, model confirmation, pinned environment controls | Real CLI/account, permission overrides against hostile configuration, real resume; remains opt-in |
| OpenRouter | Mock HTTP authentication, catalog, streaming and fallback tests | Real account and credits/limit behavior |

No real-account compatibility, Windows compatibility, optional Docker package build or approval bypass resistance is claimed by these checks. Real CLI runs must record version, redacted responses and permission behavior before changing this table or default-enabling OpenCode.


## API engines doing work

OpenAI-compatible and OpenRouter turns offer `read`, `write`, `edit`, `glob`,
`grep` (literal text search), and `shell`. Function calls must arrive in structured
`tool_calls` fields; text that resembles a call never executes. A turn has at most
24 completion steps, at most 16 calls per response, and the existing turn time
limit. Stop cancels HTTP, pending approvals and child process groups. Repeated
identical calls, unknown tools and malformed arguments end the turn with an error.
A tools-specific endpoint rejection retries once without tools and visibly labels
chat-only mode. That endpoint/model stays chat-only in this backend process until
restart. Broken structured calls also switch visibly to chat-only without executing that response. Malformed JSON arguments instead end the turn with an error.

All local tool calls pass through the existing durable approval gate. Reads are
automatic; Ask first holds edits and shell, Accept edits allows file changes,
and Plan refuses changes and shell. Shell saved rules use the same safety floor,
workspace scope, decision log, approval cards and Telegram answers as CLI turns.
Tool results are size-bounded untrusted data and cannot supply approval.

When available, file operations and shell run inside the existing turn sandbox.
If unavailable, the trusted file worker uses relative directory descriptors,
no-follow opens, regular-file checks and hard-link refusal. Shell stays refused
unless the owner explicitly sets `API_UNSANDBOXED_SHELL=true`; that exception
never bypasses enabled network isolation. File fallback requires POSIX directory
handle operations; Windows currently refuses these operations rather than using
an unsafe path fallback. No agent computer support is advertised.

The same turn-scoped memory, team, curated connected-app and marketplace MCP
launches are mounted. Their backend bridges still check grants, revocations and
one-use approvals. Existing memory/recall and enabled skills are incorporated by
the runtime. Text attachments enter the prompt; images use bounded data URLs.
Image capability describes the protocol: an endpoint/model that lacks vision
can refuse the request, and that refusal is shown rather than claiming it saw it.

Automated proof uses scripted fake completion endpoints, the real runtime,
durable approvals, local file workers and scoped MCP shims. Tests cover allow,
deny, modes, traversal, symlinks, output injection, unsupported tools, malformed
calls, repeated calls, step limits, Stop, timeout, memory search, image encoding
and connected-app allow/deny against fake Composio. Sandbox wrapper tests do not
substitute for the existing real Linux namespace enforcement tests. No live
Ollama, LM Studio, OpenRouter, remote API, account or Telegram proof was performed
for this increment.

### Waiting for a person

Turn-scoped file, app, memory and team mailboxes wait for their owning turn's
reply or cancellation. They do not report a transport failure after two minutes.
Claude's MCP tool, idle and background thresholds and Codex's per-server tool
timeout are set above the approval and execution budgets. Durable approval
expiry is unchanged. Claude, Codex and local/API engines pause their active-work
clock while the person decides. Stopping a turn still cancels its tools; no
retry gains an approval from the earlier request.
