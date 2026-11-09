# Privacy notice template

**Template, not legal advice.** The operator must replace every [PLACEHOLDER]
and review this notice for their deployment before sharing it with others.

Operator: [PLACEHOLDER: who runs this instance and their address].
Privacy contact: [PLACEHOLDER: contact].
Effective date and jurisdiction: [PLACEHOLDER].
Purposes, applicable legal basis and local rights process: [PLACEHOLDER].
Retention and backup policy: [PLACEHOLDER].

Chief of Noumenon is self-hosted. The operator controls the machine, database,
logs and backups. This project does not send usage telemetry to its authors.
The local connector's `opentelemetry-api` dependency supplies framework interfaces;
tracing, metrics, logs, operation spans and automatic export are explicitly off.
The install/build path disables Next.js telemetry. Independently installed
engine CLIs and other software have their own telemetry and privacy settings.

Your choices can send data to third parties:

- The selected engine/provider receives prompts, conversation context, selected
  memory/skills, attachments, tool results and images used for a turn. A local
  model endpoint can keep inference local; remote endpoints send it off-device.
- Connected apps receive requested operations and account credentials needed
  for them. Optional Composio and remote community MCP servers receive their
  calls and authentication. Provider retention is separate from this app.
- Telegram receives approval/hand-off details, reminders, briefs, urgent mail
  alerts and approval interactions when enabled. Incoming media is not downloaded
  by the app and does not start turns. The fallback Whisper path processes voice locally;
  optional cloud audio transcription sends audio to its configured provider.
- Bot browsers, shell commands and websites can send any data they can read.
  Screenshots can reach the selected engine. Website sessions remain on the
  chosen computer. Optional Boat computers use the person's Boat account.
- Dependency installers, engine/model downloads, marketplace/release checks
  and optional legacy desktop account flows contact their respective suppliers
  (including GitHub and the separately operated suparagent.ai legacy service).
  These are not Chief of Noumenon's hosted service.

Chat microphone voice typing uses browser speech recognition when available and
`VOICE_BROWSER_SPEECH` is true (the default). Audio goes to the browser maker:
Google is the processor for Chrome; other browsers decide their own processor.
Their retention policies apply. The first use shows a small notice, remembered
in localStorage on that device/browser profile. Live transcripts enter the draft;
sending them follows the conversation/provider rules above. Setting
`VOICE_BROWSER_SPEECH=false` keeps all chat voice processing on the computer via
the existing local transcription endpoint. This does not change separately
configured optional cloud audio transcription.

See the [data map](DATA_MAP.md) for locations, contents and retention defaults.
The operator, people with admin credentials, and anyone who controls the host
may access data. Encryption of saved provider keys is not encryption of all
conversation history and does not protect against a compromised running host.

Access, correction, deletion, complaints, processors, international transfers,
and any legally required notices: [PLACEHOLDER: operator's procedure and list].
Deleting a conversation does not delete provider records, browser caches,
external files or backups. Revoke provider access separately when disconnecting.


Gmail detail policy: a bot with a granted read may receive bounded plain-text
message bodies during its active turn, so it can find deadlines and draft from
evidence. This fixes encoded MIME bodies being treated as opaque secrets by the
generic cleaner. HTML and attachments are discarded before cleaning; HTML-only
mail is reported as unavailable rather than guessed. Bodies and retrieved
instructions remain untrusted data, never permission to send or publish.
Background brief reads omit bodies, and Telegram retains its separate alert
privacy filter. Connector audit summaries omit mail content. An engine's visible
reply and tool history may retain the bounded text under the existing conversation
retention and export controls; disabling body disclosure to an engine means
removing that bot's Gmail read grant.
