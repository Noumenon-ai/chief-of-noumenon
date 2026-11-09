# Data map

This describes this checkout's stores, not a hosted service. Paths are settings
names so an operator can find their own instance without publishing values.
Unless a row specifies expiry, there is **no automatic age-based deletion**.
Archiving a bot or conversation is not erasure. Backups and provider copies
survive deletion in the app.

| Store | Contents and location | Retention |
|---|---|---|
| Main database | SQLite at `SQLITE_PATH` (default `~/.open-dots/open-dots.db`) or configured PostgreSQL. Bots, threads, prompts, answers, tool inputs/results, approvals, saved permission rules, task boards, schedules, routines and run receipts, team jobs/rooms, notifications, needs-you state, webhook receipts, connector grants/outcomes, community MCP configuration, onboarding, reminders, preferences, contact aliases and social drafts. | Until relevant deletion/reset; many audit/setting records have no separate delete UI. Operator database lifecycle applies. |
| Saved credentials | Encrypted `user_credential` rows, engine configurations, connector connection bindings, optional provider/Telegram/Boat keys. Decryption uses `TOKEN_ENCRYPTION_KEYS`. Credential files are not the same as encrypted records. | Until forgotten, disconnected or instance deletion; revoking a provider grant is separate. |
| Owner authentication | Main DB: password hash, hashed browser/device tokens, CSRF/session metadata and hashed pairing codes. Browser cookie stores the session bearer secret. | Browser sessions renew at 30 days with a 180-day maximum age; pairing codes expire after 5 minutes. Devices can be revoked. Expiry invalidates access, not guaranteed immediate physical row erasure. |
| Phone access | `phone-access.json` beside `SQLITE_PATH`: verified Tailscale DNS name, chosen HTTPS port, loopback target and enabled flag; no auth keys. Tailscale stores its own network/Serve configuration. | Until operator removal; Turn off removes only the owned proxy handler and disables the saved address. Pairing/session expiry follows Owner authentication above. |
| Telegram alert state | `AppSetting` rows: delivered approval card IDs, notification cursor, update offset and last owner redirect timestamp. Existing Telegram-origin chat history remains in the main database. Incoming media is not downloaded. | Until instance/setting deletion; redirect timestamp enforces one reply per minute across restarts. |
| Offline website | Service worker Cache Storage holds only `offline.html`, a public explanation. No API replies, attachments or chat pages are added. | Replaced on worker version update or browser storage removal. |
| Installer configuration | `CHIEF_CONFIG_DIR/server.env`, default under the owner's XDG configuration directory, mode 0600; generated encryption/hook keys, paths, settings. `start.sh` and optional user systemd unit contain startup paths. | Until owner removal. Reinstall preserves `server.env` and connector secrets. Back up keys separately. |
| Workspace and bot notes | `LOCAL_WORKSPACE_ROOT/agents/<id>` by default, or the bot's selected external workspace. Files, `MEMORY.md`, topic notes and working artifacts; skills/templates also come from configured project and user locations. | Until explicit file deletion/reset. External workspaces are not automatically erased with a conversation. |
| Memory state | `memory-state` beside the attachments directory: journals (`journal/<id>.ndjson`), proposals, upkeep, settings and pending capture state. | Until memory deletion/reset or operator cleanup; bounded reads do not imply retention expiry. |
| Attachments | `ATTACHMENTS_DIR/<thread>` (default `~/.open-dots/attachments`): uploaded files, metadata and transcripts. Attachment text/images may enter prompt history. | Removed with thread attachment cleanup; copies in prompts, exports and backups remain. |
| Decision log | Monthly local records under `DECISION_LOG_DIR`, default `~/.open-dots/decisions`: approval and action audit summaries. | Whole months older than `DECISION_LOG_RETENTION_DAYS` (default 180) are pruned, checked at most hourly on writes. |
| Local connector | `CONNECTOR_DATA_DIR/connector.db`: connections, encrypted provider credentials, OAuth and API-token/tenant metadata. `.secret.key` and `.admin_token` are owner-only files beside it. Default directory is `~/.local/share/chief-of-noumenon/connector`; installer uses its configuration data directory. | Until connection/token deletion or owner removal; provider copies and grants must be handled separately. |
| CLI engine account and history | The official CLI's own home/config folders: login tokens, configuration, native conversation sessions and CLI logs. The app calls status/logout commands and does not parse login files. | CLI-controlled; removing an app conversation does not erase native sessions or sign out. |
| Antigravity runtime/profile | `antigravity` beside the SQLite path, including downloaded runtime and private UUID account profiles. Encrypted engine config references the selected profile. | Account removal/switch cleanup governs profiles; external Google grant revocation is separate. |
| Computers and browser state | `~/.open-dots/computers` (desktop/tenant data root when applicable), per-turn permits and screen state; Docker container writable layers, workspace mounts and persistent browser profiles. Optional Boat computers live at that provider. Native desktop uses the person's existing desktop/browser. | Computer permits expire after 15 minutes and are cleaned on close; browser sessions survive stop/start but not recreate. Computer deletion and provider lifecycle govern other copies. |
| Transient execution | Private temporary directories: MCP request/reply mailboxes, egress sockets, per-tool `/tmp`, temporary images and audio. Engine PID records under `ENGINE_PROCESS_DIR` or beside SQLite allow orphan recovery. | Normal turn/process shutdown removes transient files. Crashes can leave artifacts; operator cleanup/recovery applies. |
| Browser voice typing | With `VOICE_BROWSER_SPEECH=true` (default), supported browser speech recognition sends microphone audio to the browser maker. Google is the processor for Chrome; other browsers decide their own processor. Live text enters the draft and sent text enters conversation history. | Browser processor retention applies to audio; drafts and conversations follow their respective retention. `VOICE_BROWSER_SPEECH=false` keeps all chat voice processing on the computer using local transcription. |
| Voice/model caches | Temporary voice files are removed on success/failure; Whisper models cached under `whisper-models` in the voice data folder. Model downloads go to their distributor. | Models remain until deleted; resulting transcript follows conversation retention. Optional cloud transcription sends audio to the selected service. |
| Browser storage | Local storage: drafts, reactions, unread timestamps, profile/engine choice cache, theme, language and the browser voice privacy notice acknowledgement (`open-duet:browser-speech-notice`). Authentication cookies; paired clients hold device tokens. | Until cleared, signed out where implemented, or browser/profile removal. Clearing server history does not clear every browser cache. |
| Desktop profile | Desktop application data: profile DB/files, encrypted account/device material, local preferences, optional Boat key, logs and update downloads. Legacy account support is a separate third-party service. | Desktop reset/delete and OS application-data removal; CLI sign-ins and external computers remain separate. |
| Backups and exports | `backups` beside SQLite by default; migration backup copies, downloaded history/files, operator snapshots. Backup archives can contain clear conversations, notes and workspace files; encryption keys and CLI sign-ins are not included by the built-in backup. | Operator-managed, no automatic global expiry. Delete every copy separately. PostgreSQL needs its own backup tooling. |
| Logs and in-memory caches | Backend/connector stdout/stderr, systemd journal/proxy logs, engine error tails, short-lived status/catalog caches, OAuth state, login rate limits and event subscribers. | Memory ends with process lifetime or cache expiry; file/journal retention is operator-controlled. Errors can contain submitted data; keep logs private. |

The installer places application data and secrets outside the checkout. Default
legacy paths and explicitly chosen external workspaces may still be elsewhere.
Inspect configured path names, computer volumes, client profiles and backups
before claiming to have erased an instance. Disk deletion is not secure erasure.

Conversation cards use existing thread `Event` rows (`chat.card`,
`chat.card.answered`, and `user.message` for an explicit connect request).
They store bounded question text/options, a catalog provider/name, a random card
ID and a person's answer. They contain no API keys, OAuth client fields or tokens.
They follow the conversation's deletion/export lifecycle. A question answer is
also the next turn's person message. Greeting and one-time brief-offer markers
are owner-scoped `AppSetting` values; deleting a conversation does not reset them.
The deterministic greeting makes no model call. Daily brief activation uses the
existing routine and schedule rows. Google client configuration is shared across
Gmail and Calendar in the local connector's encrypted store; fields live briefly
in the form's memory, are cleared after sign-in begins, and are never saved in
browser draft storage. The sign-in tab holds the provider's own session.


Granted Gmail detail reads: the connector projects MIME messages before credential
cleaning. It keeps at most 30 messages and 12,000 plain-text characters per message,
with bounded MIME depth and part count. It drops HTML, raw MIME and attachments
(including base64 attachment data); HTML-only mail reports that no plain-text body
is available. Bodies are untrusted tool data returned only when the live bot turn
bridge has checked its Gmail read grant and consumed its read authorization.
Background briefs do not opt into body text. Mail input/output content remains
excluded from connector audit summaries. Text used by an engine can appear in its
conversation history under the existing history retention/export controls.

Engine replay reads at most the latest 2,000 events and labels omitted older
history; full transcript access and exports retain their existing scope. Note-file searches
and note loading run outside the request event loop, as does connector cleaning.
