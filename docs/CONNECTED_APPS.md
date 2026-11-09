# Connected apps

The default app integration is the self-hosted Open Agent Connector in `connector/` (Apache-2.0). It requires no Composio account. The registry currently contains **268 providers and 8,546 actions**, counted from `registry.list_providers()` and `registry.list_actions()`. Most providers have not been tested on live accounts. [Proven apps](PROVEN_APPS.md) records live proof separately.

## Setup

`scripts/install.sh` installs the connector's locked dependencies and provisions its encryption key, admin token and database folder outside the checkout. `scripts/start-local.sh` starts the connector and backend as separate processes. `scripts/dev.sh` starts the connector in development mode. Neither installer nor these changes connect a real provider automatically.

From `connector/server`, run `.venv/bin/python -m app.serve`. It binds only `127.0.0.1:8100`. Set `CONNECTOR_DATA_DIR` to an owner-only folder outside the checkout; the backend needs the same path to import the admin token into encrypted settings. `.secret.key` and `.admin_token` must be provisioned with mode 0600. Missing keys fail startup outside explicit `CONNECTOR_DEV=1`. The service uses umask 077. Docs, anonymous access, public access and local-token exposure are disabled. Browser clients talk to the backend; connector CORS has no allowed origins by default. No key is included in a turn's environment or MCP launch.

Bot access requires `TURN_SANDBOX_ENABLED=true` and `TURN_SANDBOX_NETWORK_ENABLED=true`. Without both, local connector tools are not mounted. A sandbox without network isolation would retain a route to loopback; silently accepting that would violate credential isolation. The isolated engine sees a mailbox, and the backend alone makes connector requests. Connector storage is explicitly excluded from sandbox mounts. The installation still needs a working Linux user-namespace sandbox.

On Apps, search the catalog and connect with an API key/token or your own OAuth client where supported. OAuth shows the provider callback URL and scopes; create the client in that provider's developer settings. There are no shared OAuth clients. OAuth callbacks pass through the owner-authenticated backend, with codes forwarded in a POST body. For a server reached at a public hostname, set `CONNECTOR_OAUTH_CALLBACK_BASE` to `https://YOUR_HOST/api/v1/integrations/connector/oauth`; keep the connector itself on loopback. Configure the UI origin in `FRONTEND_ORIGINS` and, if different from that callback origin, `CONNECTOR_ALLOWED_RETURN_ORIGINS`. Custom provider credential fields come from catalog auth configuration when available. An alias identifies an account, so two accounts at the same provider remain separate. Reconnect updates credentials for that alias. Remove deletes the connection. Check sign-in runs the provider's validation implementation. Added means credentials were saved; Signed in requires a recorded provider validation. A successful implementation check is not a claim that every action works on a live account.

Select a bot on Apps and choose each account's grant:

| Grant | Behavior |
| --- | --- |
| Off (default) | The account is absent from action search and cannot run actions. |
| Read only | Actions that are clearly reads can run without a card. See the rule below. |
| Read and ask to act | Reads plus acts after a fresh Allow on the normal approval card. |

New bots and copies have no local connector grants. Only person-facing, authenticated owner routes can change grants. No tool can grant access, change the blocked list or alter the approval mode. Telegram can answer individual Allow/Deny cards but cannot change these settings.

## Tool policy

`apps_search` and `apps_run` use the same turn-scoped mailbox transport on Claude, Codex and API engines (including local OpenAI-compatible engines with structured tool calls). ACP engines mount that mailbox and the backend performs the approval itself. The legacy detached Boat adapter has no approval/MCP channel and does not currently support connected apps.

The backend rechecks both the starting grant and current grant on every call. Actions are fetched from the local connector, never supplied as authoritative metadata by a model. An action counts as a read only when its catalog entry agrees: labelled `read` with a GET method, or with a POST or no method and a name that starts with a reading verb such as `list` or `search`. An unlabelled action, as in Gmail and Calendar, reads only with a GET method and a reading verb. Anything else, including unknown labels and any DELETE, PATCH or PUT, is an act. Extra approval cards are the accepted cost of this rule. A read label cannot authorize sending, posting, deleting, inviting, sharing, permission changes or payment actions. The reviewed override currently includes `patsnap_mcp.transfer_data`. Known financial providers, financial/billing categories and payment action patterns refuse non-read operations outright: **Payments are off**, with no approval card. `CONNECTOR_BLOCKED_PROVIDERS` adds comma-separated fully blocked provider IDs; they disappear from search and cannot run.

Act cards include provider, account alias, action and exact input. Every act needs a one-use approval; saved command rules and uninterrupted routines do not bypass it. Denied calls cannot be forged through the mailbox. The action/account description is compared again before dispatch, and approval is consumed durably before the single provider request. An uncertain result is not retried automatically. Check the provider before trying again.

Requests and outcomes are recorded in the existing decision log without raw provider content or credential values. Results are bounded and labelled untrusted. An email or web page cannot approve another action. Provider credential echoes are scrubbed at the connector before results or connector audit records are written. The backend also removes its admin token from responses. Sensitive argument keys are rejected.

In the composer, `@app` selects a connected account without granting access. “Add the Linear app” offers a Connect link to Apps. Telegram redirects incoming messages to the website. Recognizable pasted keys are removed before turn persistence and memory capture; the composer warns about credentials; Telegram starts no turns. Unrecognizable arbitrary strings cannot reliably be identified as secrets: always enter credentials on Apps.

Composio remains an optional alternative under Apps, retaining its existing curated GitHub/Gmail/Calendar tools and legacy permission behavior. Local connector grants take precedence when present; the two systems do not silently share accounts or grants. The local connector's stricter payment and routine policy applies to its own bridge.

## Verification limits

Automated tests use a local fake provider and throwaway credentials. They cover policy, approval/denial, account routing, redaction, authentication, unavailable connector responses and the shared tool bridge. They do not prove live provider compatibility. No real provider or OAuth account was used for this integration.

## Gmail: your own Google OAuth client

Gmail needs **your own Google OAuth client and your own Google sign-in**. An API
key alone cannot read a mailbox; Chief of Noumenon supplies no shared Google client.

1. In your Google Cloud project, enable the Gmail API (and Calendar API if wanted).
2. Configure the OAuth consent screen. If the project is in testing, add your
   Google account as a test user. Choose a Web application OAuth client.
3. Open Apps, choose Gmail and OAuth. Copy the exact callback URL shown there into
   the client's authorized redirect URIs. Public installations use the configured
   `CONNECTOR_OAUTH_CALLBACK_BASE`; the connector stays on loopback.
4. Enter the client ID and secret on Apps, never in chat. Review the requested
   scopes, continue to Google, and sign in yourself. For briefs and triage,
   `gmail.readonly` is sufficient; the current connector's default OAuth request
   also includes send/modify scopes, so review the consent carefully. Bot grants
   still restrict which actions are allowed independently of OAuth consent.
   While a Google project's publishing status is Testing, Google ends the access
   after 7 days and you sign in again. Publishing it needs Google's Branding page
   completed, and an unverified app then shows a warning and has a 100 user limit.
5. Give the connection a distinct alias, such as Personal or Work. Repeat for
   each mailbox, then explicitly grant each exact account to the intended bot.
   Select Read only for briefs and triage. Added and Signed in remain separate states.

In Settings → Your day, add the paused day routines for that bot and enable the
ones you want. Gmail triage reads unread mail, classifies it using conservative
English/Hebrew rules, and sends Telegram alerts only for urgent items. Every
alert names the account alias. It does not mark mail read, draft, reply or send.
Ask in an ordinary bot chat for a proposed reply; sending requires the normal
approval card and the person's explicit account grant.

The built-in reader handles up to five pages of 50 messages and reports partial
coverage. It retains hashed account/message identities for deduplication, never
message bodies. Subjects in reports are privacy-filtered; bodies/snippets are
used transiently for classification. The Telegram filter masks grouped and
international phone numbers, cards, one-time codes and identity-like numbers,
including Unicode digits, before truncation. It deliberately over-redacts numeric
runs; free text can still contain sensitive information that no pattern detects.
Synthetic provider tests are not live Gmail OAuth or mailbox proof.

The connector's Gmail GET audit records retain operational metadata only: neither
input nor output summaries, nor provider error text, are stored. The day routines
never request response caching through an idempotency header.

## Connect from a conversation

A bot can suggest a local catalog app; a suggestion does not connect an account
or grant access. An explicit “Connect Gmail” message also opens a card without
calling a model. Unknown and blocked provider IDs are refused. The person opens
the existing Apps form in a dialog, signs in in a separate tab or enters an API
key in that form, then chooses access for this bot. Read only is selected first.
Saving access continues the conversation. Failed cards can be retried. Payments
remain refused, including when an account has Read and ask to act access.

Keys and OAuth client fields are never chat inputs. They go through the existing
owner-only connector configuration endpoints; cards contain only catalog names,
provider IDs, questions, choices and answer receipts. Only an authenticated
person may answer; connecting and grants require the owner browser and CSRF.

## Your own Google project

There is no shared Google client. Choosing Gmail or Google Calendar in Apps
opens six short steps: create a project, enable Gmail, enable Calendar, configure
Branding and External audience, add your own email as a test user, and create a
Web application OAuth client. Each step links directly to its Google Cloud page.
Copy both callback addresses displayed by this installation into Authorized
redirect URIs. Paste the client ID and secret once; the local connector saves
the same client for Gmail and Calendar, encrypted on the host computer. Fields
may be left empty to reuse the saved client. Web-client formats are checked
before configuration; fields are cleared after starting sign-in.

While the project is in Testing, Google refresh tokens for these scopes expire
after seven days, so a new sign-in is needed. `redirect_uri_mismatch` means the
exact callback address needs correcting. For `access_denied`, check the test-user
email and any work-account administrator restrictions. “Google hasn't verified
this app” is expected for an unverified personal project: confirm it is your
project, then use Advanced and Go to your app (unsafe), if offered.

The installer uses `OPEN_DOTS_PUBLIC_URL` (default `http://127.0.0.1:8000`) as the
callback base and includes that address and both local aliases in allowed return
origins. When the public address is local, opening the other alias redirects
pages to the configured host before sign-in, keeping the browser's host-bound
cookie on the same host as the callback. API requests are not redirected. For a
custom address, set the public URL before installation and register the callbacks
shown in Apps. Existing configuration is preserved on reinstall.

Steps checked against Google's documentation on 2026-11-04 (public documentation
only; no provider sign-in or API request):
[Create credentials](https://developers.google.com/workspace/guides/create-credentials),
[Configure consent](https://developers.google.com/workspace/guides/configure-oauth-consent),
[Web application OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
and [token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).
