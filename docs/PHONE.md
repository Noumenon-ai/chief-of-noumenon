# Use on your phone

Run the installed website, open **Settings → Use on your phone**, and follow its
three steps. The chat menu also links there. Install [Tailscale](https://tailscale.com/download)
on your computer and phone, and sign in to the same personal account on both.
The page creates a private HTTPS address and a one-time sign-in QR code. Keep
both devices connected to Tailscale and keep the computer awake.

Step 1 shows the computer's signed-in account (for example, **GitHub account
example-user**) and the number of other joined and online devices. With zero peers,
it says: "No phone has joined yet. On the phone, install Tailscale, sign in with
GitHub account example-user, and turn it on." Choose the matching sign-in provider
on the phone. A private link being on does not mean the phone has joined.
Peer counts include all other devices, not just phones; they cannot prove that
this particular phone is connected. Missing account or peer fields are unknown.

If you cannot open the link:

- Check that Tailscale on the phone shows **Connected**.
- Sign in to the same account as the computer.
- On Android, check that the VPN key icon is on.
- Wait a minute, then try again.

Status reads use fixed, timed CLI arguments, capped output and background JSON
parsing. Only the computer's own login label and aggregate peer counts are
returned; other users' names, addresses and device details are never shown.

On iPhone, open the website in Safari, tap Share, then Add to Home Screen.
On Android, open Chrome's menu and choose Add to Home screen or Install app.
Chat, attachments, approvals and browser microphone recording use the website.
Choose **עברית**, **English**, or **Auto** beside the microphone before recording.
The list comes from the server's `TELEGRAM_VOICE_LANGUAGES` setting (for example,
`he,en`). Auto is the default; this browser remembers your choice independently
of the interface language. Choose Hebrew for short Hebrew phrases that Auto
mistakes for English. If the allowed list changes, an unavailable saved choice
returns to Auto. An empty server list offers only Auto; local transcription
detects the language, while browser speech uses the device language.
Tap the microphone once to record. When allowed and supported, browser speech
recognition shows words live while you talk, restarting automatically after
silence. A single configured language is used directly (English uses en-US);
with multiple languages, your selection is used and Auto uses the device language.
This website cannot open the phone keyboard's microphone.

Browser voice typing sends audio to the browser maker. Google is the processor
for Chrome; other browsers decide their own processor and retention. A small
notice appears the first time it is used on this device, remembered in localStorage.
Set `VOICE_BROWSER_SPEECH=false` on the server and restart to keep all chat voice
processing on the computer. The setting defaults to true. When disabled,
unavailable, or a browser network/audio/language error occurs, the existing
`POST /api/v1/voice/transcribe` path uses local transcription. On an error, words
already heard are kept and local recording starts; keep speaking. Later recordings
on the same page also use local transcription. Its draft refreshes about every
1.5 seconds. Tap **Send** or press Enter
while recording to stop, finish transcription, and send once automatically.
Browser speech waits at most 1.5 seconds for its final result; silence sends nothing.
Tap the microphone again to finish into an editable draft instead. Text typed
before recording is kept; if final transcription fails, nothing is sent and
that text stays in the box. Telegram voice notes keep Auto. The language picker
is shown only when at least two languages are configured.

Local transcription requires the backend's optional `voice` extra.
`VOICE_MODEL` defaults to `small`; a more capable model such as `large-v3` can
improve accuracy on a sufficiently provisioned GPU. `VOICE_DEVICE` accepts
`auto` (default), `cpu`, or `cuda`. Auto checks CTranslate2's CUDA device count,
using CUDA float16 when available and CPU int8 otherwise. A CUDA model load
failure logs a warning and retries the same model on CPU int8. Larger models
also need more memory and take longer on CPU. Restart after changing settings.
Models download into `telegram/whisper-models` beside the server's SQLite data
file. With the optional voice package installed, `VOICE_PRELOAD` (default true)
warms the model in the background at startup without delaying startup. Set it
to false for offline tests or to load on demand. Recordings are temporary and
remain limited to 20 MB. A slow first load
returns “Preparing voice model, try again in a minute”; preparation continues
without keeping your recording, so record again once it is ready.
Only the owner's eligible browser, desktop or loopback session can read the
voice options from `/api/v1/local/status` or use browser transcription; the
owner's paired Chat browser retains its existing recording access.

If the computer cannot be reached, an offline explanation appears; messages
and files are not cached by the service worker.

The QR code signs the browser in with **Chat** access, including approval
answers, attachments and browser recording. It does not grant Settings,
computer control or bot administration. Use the owner's signed-in browser for
those controls. Phone controls for bot creation, deletion and editing are hidden; Apps, Settings and routines direct you to your computer before loading owner-only data. The Chat scope is unchanged. Codes expire after five minutes and work once. Revoke a lost
phone in Settings → Account & privacy → Devices.

The setup page requires the same-origin installation made by `scripts/install.sh`
and `app.server`, built with `NEXT_PUBLIC_API_BASE_URL=/api/v1`. A separate
frontend development server cannot make a working phone QR code and says so.
The feature supports the root install with a loopback listener. It never changes
the listener, creates a LAN/public bind, or enables a public tunnel.

The app reads the current Tailscale Serve configuration before selecting 443,
8443 or 10000. It skips occupied ports, including foreground and service entries,
and reports when none is free. An ownership record beside `SQLITE_PATH` identifies
the entry it created. Turn off removes only its matching root handler, preserving
other paths and services. A changed entry or a listener shared with another hostname is left alone. Avoid concurrently
editing the same Serve configuration outside the app while turning it on or off;
the CLI has no transaction spanning the app's read and its subsequent command.

On Linux, if Turn on reports access denied, run `sudo tailscale set --operator=$USER`
once, then Check again.

If HTTPS certificates are disabled, enable them on the
[Tailscale DNS page](https://login.tailscale.com/admin/dns), then Check again.
Tailscale account/device access rules still determine which devices can reach
the machine; use your own personal network and do not share this machine with
other users. The app's sign-in and scopes remain required.

Implementation follows the [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve).
QR generation runs locally with `qrcode-generator` 2.0.4 (MIT, no runtime
dependencies); no image or QR service receives a sign-in code.
