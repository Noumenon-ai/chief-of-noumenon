# Security and reporting

Live Linux checks on 2026-11-04 demonstrated login-folder isolation through
shell commands, file tools and path traversal on the tested Claude Code and
Codex versions while normal workspace work remained possible. This is not a
claim about every future engine version. See [PROVEN_APPS.md](PROVEN_APPS.md).

Report a suspected vulnerability privately to [PLACEHOLDER: security contact
and reporting channel]. Include affected version, reproduction steps using
synthetic data, and expected/observed behavior. Do not include real credentials.
The operator must replace this contact before release.

## Threat model

One trusted owner operates the instance and chooses engines, workspaces,
providers and tools. Untrusted messages, web pages, app responses, files and
model output can contain prompt injections. We aim to prevent those inputs
from granting their own permissions or reading backend/provider credentials
through model-invoked tools. The OS, administrator, backend, installed engine
binaries and approved tool implementations remain trusted.

## Boundaries implemented

The owner passphrase, scoped device sessions, CSRF checks and loopback/default
host policy protect the API. Saved provider keys are encrypted with
`TOKEN_ENCRYPTION_KEYS`. Backend mailboxes hold connected-app credentials,
computer access and approval authority outside the engine. Actions pass through
the durable approval gate; plan mode rejects workspace mutation and saved
command rules remain scoped. Unknown external-write outcomes require a new
person decision before a retry.

On Linux, enabled bubblewrap turns use explicit mounts, private process and
temporary namespaces, and optional public HTTP(S) egress filtering. Failed
preflight does not retry unboxed. Claude native tools, including native web
fetch, are disabled with `--tools ""`; native settings/hooks are restricted.
Workspace operations use a separate backend-launched sandbox with a synthetic
home, no login mount, no provider-key environment and no owner-added path
grants. The engine sees an empty workspace at its normal working path so it
cannot auto-load model-written hooks or context-file symlinks. Selected skills
and memory still arrive through the app's context and mailbox mechanisms.

## What is not protected

A bot with internet access can send out anything it can read. Public egress
filtering is not data-loss prevention or a provider-only allowlist. Do not put
secrets in workspaces, prompts, memory, attachments or computer/browser sessions.
An allowed shell command can read all exposed workspace files and runtimes.
Approving it is not proof that it is safe.

The engine process itself retains its login folder and refresh ability; a
compromised CLI, trusted runtime, kernel or host administrator is outside this
boundary. Mailbox responses, engine transcripts and provider responses can
contain private information. The app does not promise protection from a CLI
that exposes internal state through a future native tool or extension.

Codex's protected adapter selects a generated `con` permission profile: root
access is denied, minimal/runtime/resolver paths are readable, and only the agent
workspace is writable (read-only for plan). Whole homes, CODEX_HOME, application
data, connector data and computer state are not granted. A native `codex sandbox`
preflight uses an app-created login canary, removes it afterwards, and fails closed.
Successful results are cached by version, workspace and exact profile. Each turn
uses a fresh app-server and selects the same named profile on start/resume and
turn start, without legacy sandbox overrides. See [the exact contract](ENGINES.md#codex).

Startup overrides disable inherited MCP servers, plugins, apps, hooks, host skill
discovery and web search. Only app-mounted MCP servers are attached to the thread.
Their shims run beside the trusted engine with credential-free launch descriptors;
connected-app credentials remain in backend mailbox handlers. This does not make
these unboxed shims safe against a compromised engine or malicious trusted code.

Untrusted approval policy and the user reviewer remain active in every protected
mode. Outside-workspace patches, grant-root requests and explicit command
permission expansions are denied without cards. Workspace edits and ordinary
command approval requests use existing cards and rules. Codex may run safe
commands without approval; the native sandbox, not the card, must deny login
reads. Completion after denial and successful unapproved patches stop the engine.
The event monitor cannot reverse effects or restore confidentiality after a read.

This does not sandbox the Codex process itself or prove that every future native
tool honors the command profile. Engine-level config/context reads and secrets
in the inherited environment remain outside the command filesystem boundary.
A CLI regression that drops permissions on resume must be caught by dispatcher
live tests as well as profile-response checks. Local help/schema and fake-engine
checks do not establish that guarantee. The optional HTTP egress gate cannot wrap
Codex's native sandbox: native networking is disabled when that gate is enabled;
otherwise network access is unrestricted with resolver reads allowed.

With sandbox protection explicitly disabled, legacy Codex/ACP/native desktop
behavior is not credential isolation. Do not disable it to claim release
readiness. ACP engines retain their differing native-tool policies and have not
received this split.

Browser sessions and native desktop control can act as logged-in users. App
permissions do not block visits to an app's website. External providers, prompt
correctness, account terms, malicious approved tools, backups, physical disk
access, availability attacks and multi-tenant hostile hosting are not secured
by approval cards. This is a single-owner system, not a hardened public service.

Keep the service behind TLS for remote access, keep default loopback/private
connector settings, restrict workspace contents, update trusted binaries, and
review [engine limitations](ENGINES.md) and [data retention](DATA_MAP.md).

## Private phone access and installable website

`/api/v1/phone/{status,on,off,pairing-code}` are POST endpoints requiring the
single server owner's admin session, JSON, the existing cookie CSRF check and
a shared per-process limit of 20 requests per minute. Hosted tenants, chat
sessions and anonymous callers cannot manage access. There is no user-supplied
command, host, port or target. The CLI uses subprocess argument lists, no shell,
closed stdin and a 12-second timeout per command. Tool errors redact keys and
URLs. No Tailscale auth key is requested or stored.

The listener remains loopback. Serve exposes only a private HTTPS proxy; no
Funnel or public/LAN binding is created. The app reads the current configuration,
reserves a free port from 443/8443/10000, records ownership, and removes only its
matching root handler. An externally changed entry is never removed. External
concurrent Serve edits remain outside the app's lock; do not edit this same
configuration concurrently. A Funnel entry is not recognized as private access.
The Tailscale personal account and network rules control device reachability.

Only the exact verified Self.DNSName is added to trusted hosts, never `*.ts.net`.
The standard same-origin checks and trusted-loopback proxy handling provide
HTTPS cookies and CSRF over that address. The ownership record persists the
verified name across restarts and is rechecked on phone-page operations. Turn
off disables advertisement and trust for that entry; revoking paired sessions
remains a separate operation in Devices.

QR codes use the existing hashed, five-minute, single-use pairing store and
put the code in the URL fragment, which never reaches an access log. The browser
removes it from history before redeeming. Pairing responses are not cached.
Phone codes grant Chat, including chat/attachments/approval answers; only
browser voice transcription was added to that scope. It still requires CSRF,
bounds audio size and rejects hosted tenants and autonomous assistant sessions.
Phones do not gain administration or live computer control through pairing.

The service worker caches only the public offline explanation. It never caches
chat pages, API replies, attachments, audio or file downloads. Existing browser
drafts/local storage still follow DATA_MAP.md. Telegram receives alerts and
approval decisions only; owner messages cannot start turns or download media.

## Conversation cards

Question, connection and daily-brief suggestions are data, not authorization.
Claude, Codex and local engines that support tools receive bounded schemas for
`ask_question`, `suggest_connect` and `offer_daily_brief`. Engines without tool
support ask in plain text. Card tools are unavailable in autonomous, draft,
media-review and restricted-origin turns. They cannot answer their own cards,
configure providers, grant accounts or replace an action approval.

The local catalog validates provider identifiers, including blocked-provider
policy, both when a card is created and when it is completed. Cards accept no
credential fields. Recognizable credentials are rejected from tool input and
redacted from durable tool/approval records. Google client fields use only the
existing owner-only configuration call, never thread events, model prompts or
application log messages. Request bodies must not be logged by an operator's
reverse proxy. Provider output and choice text remain untrusted text in the UI.

Answers check authentication, CSRF for browser sessions, thread ownership and
person scope. A question answer and its next turn commit together; repeated
answers cannot start another turn. Connecting and granting require owner access;
a connection receipt verifies the account and saved bot grant before continuing.
Brief installation creates paused templates. Only an owner's explicit tap enables
the morning routine at 08:00 in their time zone, in read-only plan mode. Existing
action approvals remain separate and cannot be answered through a question card.

Confined workspace read, glob and grep tools run without an approval card in Ask
mode too. Paths still pass the existing relative-path, descriptor-based no-follow,
symlink/hardlink and private-login-file guards. Writes, edits, shell commands and
outside-folder access retain their existing gates. A free read is not permission
to escape the workspace or read engine login material.
