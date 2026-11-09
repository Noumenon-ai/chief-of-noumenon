# Capability and release qualification

Reviewed 2026-10-25 against feature source `6b7fba1` / integrated checkpoint
`cbc62b7`; baseline `15caa55`. See the [automated verification record](verification/roadmap-next-20261025.md).
This table describes source
support. A successful scripted test does not establish real-provider behavior
or compatibility with an installer. New commits require a new qualification
record before release.

## Engines

| Engine | Prerequisite and model choice | Attachments | Approvals | Teams and chat setup | Computers / browser | Continuation |
|---|---|---|---|---|---|---|
| Claude | Installed, signed-in `claude`; catalog suggestions and custom IDs | Text and images | Per-tool gate; Ask, Accept edits, native Approve for me, Plan | Yes | Docker and opt-in native macOS; Docker Chromium | Native resume |
| Codex | Installed, signed-in `codex`; catalog suggestions and custom IDs | Text | App-server approval requests, native auto reviewer, and checked sandbox policy | Yes | Docker, including opt-in Chromium; native macOS unavailable | Native thread resume |
| Gemini CLI | Installed and authenticated CLI or saved key; selected model confirmed by ACP | Text | ACP permission requests; upstream configuration also matters | Unavailable | Unavailable | Native if advertised; otherwise stored transcript |
| Cursor | Installed and authenticated CLI or saved key; live model catalog | Text | ACP permission requests; native `--auto-review` | Unavailable | Unavailable | Native if advertised; otherwise stored transcript |
| Antigravity | Managed runtime and isolated personal Google sign-in; account model catalog | Text | ACP permission requests; default mode confirmed before prompt | Unavailable | Unavailable | Native resume within the same account profile |
| OpenCode (opt-in experimental) | Installed and authenticated CLI; offered model confirmed | Text | Permission override unqualified against hostile real configuration | Unavailable | Unavailable | Native if advertised; otherwise stored transcript |
| Generic ACP | Configured authenticated ACP command; agent default model | Text | ACP permission requests; upstream configuration also matters | Unavailable | Unavailable | Native if advertised; otherwise stored transcript |
| OpenAI-compatible / OpenRouter | Configured endpoint and optional key / OpenRouter key; endpoint model IDs | Text and model-dependent images | Workspace tools through the shared gate; structured calls required | Unavailable | Scoped MCP bridges | Stored transcript |

Text attachments are bounded text added to the prompt. Images are accepted only
by engines advertising image support. Cross-chat history search is available
through the memory bridge on Claude, Codex, ACP and API engines, subject to agent settings;
it does not itself persist notes. See [memory](MEMORY.md).

Connected apps default to the self-hosted connector, with per-account bot grants,
free reads, fresh approvals for acts and payments off. Claude, Codex, API and ACP
engines use the backend bridge. Composio remains an optional alternative with its
legacy curated tools and permission behavior. Most of the 268 providers have not
been tested live. See [connected apps](CONNECTED_APPS.md).

## Evidence levels

| Feature | Source / automated coverage | Live-provider evidence already recorded | Packaged release gate |
|---|---|---|---|
| Guided agent create, correction and Undo | Team service, router, Codex protocol and frontend tests | Codex CLI 0.164.0 create → same-agent correction → Undo, recorded 2026-10-24 in [chat management](CHAT_MANAGEMENT.md) | Open on macOS and Windows; Claude live flow also open |
| Delegation and rooms | Scripted engine tests, policy/origin checks and lifecycle tests | Codex long delegation and restart/resume remain open; setup evidence does not qualify delegation | Open |
| Planner claim/run lifecycle | Planner service and API tests | Real selected-engine task execution remains a separate gate | Open |
| Docker computer tools | Scripted protocol/isolation tests | Codex CLI 0.164.0 Docker command confinement recorded in [engines](ENGINES.md#codex); focused macOS checks recorded in [computers](COMPUTERS.md) | Open on each shipped platform |
| Structured Chromium | Boundary tests and opt-in real Chromium fixture suite | Codex provider/browser flow remains open | Open |
| Antigravity | Synthetic install, OAuth, model, approval and resume tests; official macOS ARM64 runtime startup | OAuth URL startup only; complete account sign-in and prompt/approval/resume remain open | Open; Windows unsupported |
| Install/update/recovery | Desktop launcher, updater and backend startup tests | Installer download/install, upgrade preservation and recovery require actual artifacts | Open |
| Personal server | Server smoke, pairing and lease tests | Real Linux deployment, sign-in, update and backup/restore remain open | Open |
| Explicit private notes | Standalone literal remember requests, no-helper Codex fixture, provenance, simple correction, redaction and Undo tests | Real-provider response behavior remains open | Open |
| Webhook deduplication | Durable delivery receipts, concurrent SQLite admission, restart and authorization tests; PostgreSQL schema/migration checks | Live PostgreSQL concurrency remains open | Open |
| Linux turn sandbox preview | Default Linux server filesystem/PID box with explicit opt-out, plus separately enabled private network namespace/public HTTP(S) gate; policy and transport tests, real namespace checks skip on macOS | Real Linux enforcement and engine lifecycle remain open | Open |
| Routine change receipts and Undo | Dedicated source result card; revision/run/scope-bound Undo, paused restoration and concurrent SQLite checks | Real providers and PostgreSQL multi-backend Undo remain open | Open |
| Connected apps (any Composio app; GitHub, Gmail and Calendar with their own tools) | Client, catalog, routes, approval policy and bridge; generic search/run with schema checks, first-use records and re-checks after approval; Claude and Codex turns with a fake Composio following the published OpenAPI | Windows, desktop and web, real Claude CLI, own Composio project and a private repository, 2026-10-26, by hand (see [connected apps](CONNECTED_APPS.md#what-has-been-checked)); Codex/Gmail live calls not checked | Open; packaged shim, Linux sandbox and live Codex flow not run |
| Local Today brief | Durable approvals/questions, routine outcomes, engine failures and due tasks; source links, timezone and deduplication checks | Live-source and packaged UI qualification remain open; Calendar/Gmail unavailable | Open |

Historical evidence belongs to the source and environment recorded in its
linked guide. It is not automatically refreshed by running a newer unit suite.
Unlisted live-provider or packaged combinations are unqualified.

## Platforms and release procedure

macOS ARM64 and Windows x64 are desktop package targets. Native macOS control
requires a separately staged reviewed bundle and is omitted from the unsigned
installer. Antigravity and preset CLIs are not supported on Windows. Linux is
the personal-server target; desktop unit tests on macOS do not qualify it.

For each candidate, record the source SHA, release tag, artifact filename and
SHA-256, OS/architecture, engine/CLI version, database and date. For each row
above, record **passed**, **failed**, **not run**, or **unsupported**, and link
the exact command/output or redacted manual evidence. Keep live-provider and
packaged results in separate columns.

1. Run backend tests on SQLite and PostgreSQL, frontend checks, desktop tests,
   backend/server smoke and the isolated Chromium suite. Preserve failures and
   skip reasons. A skipped real-service test is not a pass for that service.
2. Build the candidate from the recorded source. On each target OS, install
   into a fresh profile, sign in, and exercise chat, approvals, Stop and resume.
   Check the feature rows above with the actual packaged backend and UI.
3. Upgrade a populated earlier profile. Verify agents, history, planner tasks,
   routines, encrypted configuration and sign-in remain usable. Check rejected
   downloads, unavailable engines and interrupted-start recovery.
4. For a server release, deploy on real Linux and verify owner sign-in,
   pairing/revocation, engine sign-in, update, backup and restore. Qualify
   filesystem/process and network isolation separately before expanding
   unattended integrations.
5. Publish the completed matrix beside the artifact. Leave every unexecuted
   gate open; a source implementation or a green CI run cannot close it.


## Job 2 qualification boundary

API engines now execute structured workspace and scoped MCP tools with the same
approval modes and durable decisions. See [Engines](ENGINES.md#api-engines-doing-work)
for bounds, fallback behavior and platform limits. Automated fake-endpoint tests
are implementation proof, not live model/provider qualification.

The [stdio MCP entry point](MCP.md) uses an `assistant` paired-device scope:
conversations, task cards and existing routine runs, with read-only pending
approvals. The scope refuses settings, credentials, grants and approval answers.
It holds no database connection. The optional MCP SDK is absent from the lock;
the implementation uses the repository's existing line-delimited JSON-RPC pattern.

First-run discovery probes CLI status and fixed loopback Ollama/LM Studio ports.
Configured API engines are selected from saved configuration without a remote
readiness request. `Chief` creation is atomic and idempotent with Ask first.
Installer tests stub dependency managers and systemd: downloads, a real Linux
installation, packaged desktop behavior and user-session service startup remain
unqualified. Owner passphrase setup and optional Telegram settings are unchanged.

## Self-hosted connected apps

The default local connector has 268 registered providers and 8,546 actions; most
providers have not been tested on live accounts. API keys and your own configured
OAuth clients are managed on Apps, with account aliases and per-bot account grants.
Reads run freely, acts need one-use approval, and payments are off. Claude, Codex,
OpenAI-compatible/OpenRouter (including local tool-capable models), and ACP use the
backend bridge. This requires the isolated Linux turn sandbox; the legacy detached
Boat adapter has no connected-app approval channel. Composio remains an optional
alternative with its existing behavior. See [Connected apps](CONNECTED_APPS.md) and
[Proven apps](PROVEN_APPS.md) for setup and verification limits.

## Day-one chief-of-staff workflows (job 6)

Implemented: first-run Chief as team lead; explicit idempotent Inbox/Calendar/
Research/Builder starter action with no grants; bilingual personal reminders;
paused opt-in morning/evening brief and Gmail triage routines; per-account
read-only retrieval; Telegram alert privacy filtering; optional offline Shabbat
and festival quiet windows. Controls extend the existing Control Room bot rail,
first-run view and Settings. Existing room and delegation transcripts retain bot
attribution. Delegated specialist approvals reach Telegram with the specialist's
name through the existing owner-bound cards.

Automated evidence uses synthetic mail, fake Telegram/provider responses, an
isolated database and scripted engine calls. It covers parser ambiguity and DST,
catch-up and app-notification deduplication, ownership/authentication, starter
idempotency/no grants, source failure and injected mail instructions, international
number redaction, calendar boundaries, quiet summaries and specialist cards.
The responsive browser harness exercises the controls at 1440 and 390 pixels.
Exact final suite counts and limitations are recorded in the job report.

**Not live proof:** Google OAuth consent, real multi-account Gmail, real scheduled
brief delivery, real Hebrew reminder alert delivery, and real location-specific
religious times. Brief/triage logic is deterministic and bounded, not an autonomous
mail agent. The quiet window uses broad civil times, not astronomical boundaries.
Telegram acknowledgement loss can duplicate an outgoing message; database reminder
and notification creation are deduplicated. See [Routines](ROUTINES.md) and
[Connected apps](CONNECTED_APPS.md) for the limits.

## Send outcomes, contacts and saved post drafts (job 7)

Connected-app actions return an explicit `done`, `failed` or `unknown` outcome,
with a reporting instruction. `done` means the provider confirmed the operation;
it does not mean a recipient received or read a message. Transport timeouts,
server failures and unreadable receipts are uncertain. Exact request fingerprints
are reserved before dispatch without saving addresses or provider content. An
identical unknown retry needs a fresh card labelled as a possible duplicate.
The local connector and optional Composio bridge record outcomes in the decision
log and emit the same outcome for conversation receipts and the resolved Telegram approval card. Existing
Composio permission behavior remains; an unknown retry overrides automatic
permission. These checks use synthetic providers, not live delivery evidence.

`find_contact` is a read-only team tool. This implementation supports **HubSpot
and Front** contact accounts, plus the owner's Settings contact aliases. Google
Contacts is not implemented here. An alias belongs to one contact account and
is visible only while that exact account is granted to the calling bot. English
case and Hebrew vowel marks are normalized; nicknames must be supplied by the
owner. Multiple matches are returned as choices with an instruction to ask.
Reads are bounded to five accounts and 100 results per account; incomplete
coverage is reported and never labelled a unique resolution. Lookup uses the
same connected-app gate and rechecks grants. Contact output is untrusted data,
not permission to send. Exact addresses remain visible in send inputs; names
resolved in the current turn are added to local sending cards. Contact read
contents are excluded from connector audit summaries and decision-log summaries.
The conversation can contain the requested contact result; it is not a private
address-book vault.

`check_post_draft` checks named-network editing budgets, links, near duplicates
against at most 200 locally saved drafts/posts, and the existing alert privacy
filter. Network lengths are estimates, not live provider/account validation.
Settings contains the draft list, edit, check, copy and remove controls, including
saving already-published text for comparison. The tool does not save or publish.
There is no timeline reader, comment tool or reply tool in this feature. Actual
posting uses connected apps, the person's own account and an approval; X also
requires the person's own API credits. Privacy patterns deliberately over-redact
and cannot detect every sensitive statement. Saved drafts and aliases use
owner-scoped settings and authenticated owner routes; tools cannot edit aliases,
grants or approval rules.

The team tool bridge provides `pdf_read`, `pdf_info`, `pdf_merge`, `pdf_split`,
`pdf_fill_form` and `pdf_add_signature` on engines with team MCP support (Claude,
Codex and API, plus a PDF-only catalog on ACP). These tools operate only in the calling bot's current folder.
Reads require no approval; merge/split use normal write approval (Accept edits
permits them); Plan refuses all writes. Every fill or signature needs a fresh
person card showing the document and exact fields/values or signature/placement,
even with Always allow or uninterrupted routines. Every output is a new file.

Inputs are limited to 20 MiB each and 200 total pages, with a 15-second worker
timeout plus CPU/memory bounds. Reads return at most 20 pages and 16,000 characters;
info bounds form output and reports truncation. Paths reject traversal, symlinks
and hardlinks. The worker uses the turn sandbox when enabled and fails closed if
that sandbox is unavailable. On supported POSIX hosts with sandboxing disabled,
file descriptor confinement and process resource limits still apply. Platforms
without secure descriptor-relative file operations fail closed. Encrypted and
malformed PDFs return plain refusals. PDF text and field values are untrusted data,
never instructions or permission to act. No OCR, certificate signing, or password
removal is provided. Split extracts one stated range per call. Typed signatures
use printable ASCII; other scripts require a PNG/JPEG signature image from the
bot folder. A visible signature is **not a certified digital signature**; the
person is responsible for whether it is acceptable for their purpose.

Coverage uses small synthetic PDFs and scripted Claude, Codex and API engines,
plus ACP catalog and gate checks;
it is not evidence of real-provider behavior or packaged-platform qualification.
