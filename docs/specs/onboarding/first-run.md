# First-run setup

> **Type:** spec · **Status:** source implemented, qualification pending · **Verified against:** baseline 4194bb4 plus working-tree changes on 2026-10-28

Open the desktop app and sign in to your app account using the code sent to your
email. The first sign-in asks you to associate the local profile with that account,
including any existing agents and conversations. This does not upload the data,
connect an inbox, or sign you in to an AI provider. A profile stays associated
with that account after sign-out. Use a separate desktop profile for another
account; moving data between accounts is not part of this flow.

On first open, the owner flow checks for existing agents. If there are none,
local discovery chooses a ready signed-in Claude or Codex CLI first, then other
ready CLIs, a configured API engine, then a model at the default loopback Ollama
or LM Studio address. It creates `Chief` with Ask first approvals and offers a
small link to change its engine. Creation and its receipt share a transaction;
concurrent opens and retries do not create extra agents or overwrite existing ones.

Detection never probes a configured remote API. CLI status checks may use the
CLI's own authentication behavior. Local HTTP checks have fixed IP addresses,
short timeouts, bounded responses, no environment proxy and no redirects.

If nothing is ready, one screen offers CLI sign-in commands, an API key form,
and local-model instructions. It rechecks automatically. Owner passphrase setup
stays as it is; Telegram alerts remain optional in Settings; private phone chat uses Settings → Use on your phone. Existing users may still
reopen the older agent-configuration guide from Settings.

The first-reply milestone still requires a successful stored turn. Scripted
automated tests cover priority, local-only discovery, concurrent creation,
existing agents and redirects. Real provider sign-in, model downloads and packaged
first-open behavior have not been tested for this increment.

## Engines and optional permissions

On macOS and Linux desktop builds with Node.js/npm available, Install offers an
app-managed copy of Claude, Codex or OpenCode. This does not overwrite a system
CLI. Each operation stages in the app data folder, checks the executable's
version and atomically selects the release. Failed or cancelled updates retain
the previous managed release. Check engine status afterward, then use the
existing provider sign-in controls. Windows managed installation is not yet
supported; manual installation and provider guides remain available.

The Mac permission panel reads Accessibility and Screen Recording status, opens
only the corresponding System Settings panes, and rechecks on focus or request.
Permissions are optional for chat and do not grant any agent computer access.
Configure a particular agent's native computer separately. Other systems do not
show Mac permission actions. Connect apps from Settings only when needed.

## Account-service integration and verification limits

The desktop backend proxies the fixed account-service HTTPS endpoint at
`https://suparagent.ai/api/v1/accounts/desktop`. The service must implement email
start/verify, session lookup and sign-out before distributing this desktop build.
Existing hosted password sign-in and standalone owner-passphrase sign-in remain
separate paths. Fresh sign-in needs network access; after the short validation
cache expires, account-service failures show retry and keep the workspace locked.

Automated backend tests and browser fixtures cover core setup and account
behavior. The static UI builds and type-checks. Real email delivery, real provider
sign-in/reply, actual CLI installation downloads, OS permission dialogs, packaged
macOS/Windows installers and production endpoint deployment have not been
qualified for this change. Do not describe this as a released or fully qualified
onboarding experience until those checks pass.
