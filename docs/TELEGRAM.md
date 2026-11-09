# Optional Telegram alerts

The website is where you chat. Telegram is optional and sends only approvals,
hand-offs needing you, reminders, briefs and urgent mail alerts. Existing
Telegram-origin conversations stay readable in the website. Open **Settings →
Use on your phone** for private phone access; see [phone setup](PHONE.md).

To enable alerts, create a bot through BotFather, obtain your numeric Telegram
user ID, and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID` on the server.
Leave both unset to disable Telegram. Missing one or an invalid owner ID stops
startup with an explanation. Never put a token in a repository or chat.

From `backend`, run `.venv/bin/python -m app.telegram_bot` with the website's
same database and data directory. Open the bot's private chat and press Start
to permit delivery. Keep the poller running alongside the backend.
`scripts/dev.sh` starts it only when configured. One OS lock admits one poller;
do not use this bot token from another host at the same time.

Allow and Deny remain bound to the approval, owner and delivered card; the first
decision wins. Hand-offs use Continue and Cancel. All pending owner approvals
are delivered, including website and specialist chats, without needing an old
Telegram conversation. Each alert has an Open button when this app has a known
private phone address. It points to the exact chat when the alert has one;
notices without a chat open the chat list. Otherwise there is no link. No public
address or localhost link is substituted.

Incoming text, commands, photos, files and voice never start a turn or download
media. The owner gets one short reminder to chat in the app, with its private
link when known, at most once per minute across restarts. Other users and groups
are ignored. Incoming updates are reserved before handling. Telegram cannot
change approval modes, grants or Settings.

Durable notice cursors and card IDs survive restarts and failed deliveries.
The quiet notification policy still applies. `ROUTINE_TELEGRAM_CHAT_ID`, when
set to the same owner ID, adds routine notices needing input; routine completion
chatter is not delivered. Telegram has no send idempotency key: acknowledgement
loss after sending can duplicate an alert, but cannot execute an approval twice.
Message bodies, tokens, filenames and tool errors are not logged by the poller.

Browser microphone transcription remains in the shared voice service. Install
the backend `voice` extra for local Whisper. Its first model download needs an
internet connection. `TELEGRAM_VOICE_LANGUAGES=he,en` retains its compatibility
name and limits browser language detection too. Temporary audio is removed on
success and failure; the existing model cache remains under `telegram/whisper-models`.
The old Boat task/result and schedule helpers remain for existing callers and
regression coverage; the alert poller never calls them.
