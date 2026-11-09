# Open Agent Connector in Chief of Noumenon

This is the imported Apache-2.0 Open Agent Connector server. See [UPSTREAM.md](UPSTREAM.md)
for its source revision and [LICENSE](LICENSE). The upstream web client was not imported;
use Chief's Apps page. The registry contains **268 providers and 8,546 actions**, counted
with `registry.list_providers()` and `registry.list_actions()`. Most providers have not
been tested on live accounts. Record live proof in [Proven apps](../docs/PROVEN_APPS.md).

## Run locally

The repository's `scripts/install.sh` installs `server/requirements.lock` in a separate
venv and provisions storage outside the checkout. The generated start command uses
`scripts/start-local.sh` to start the connector and backend as separate processes.
`scripts/dev.sh` runs the connector in explicit development mode.

From `connector/server`, run `.venv/bin/python -m app.serve` to start just the connector.
Set `CONNECTOR_DATA_DIR` to an owner-only directory outside the checkout, containing
`.secret.key`, `.admin_token` and `connector.db` (files 0600, directory 0700). Missing
keys fail startup except in explicit `CONNECTOR_DEV=1` mode. Preserve the encryption
key securely with backups. The entry point sets umask 077.

The service binds **127.0.0.1:8100 only**. It refuses public/anonymous access and local
token exposure. Docs/OpenAPI and browser CORS origins are disabled by default. Do not
expose this port publicly or give its admin token to a model. The backend needs the
same `CONNECTOR_DATA_DIR` to import the admin token into encrypted settings. Its
`CONNECTOR_URL` defaults to `http://127.0.0.1:8100`; only an HTTP loopback origin is accepted.

OAuth callbacks use the backend, not the private connector port. For a remote installation,
set `CONNECTOR_OAUTH_CALLBACK_BASE=https://YOUR_HOST/api/v1/integrations/connector/oauth`
and configure the frontend/return origins as described in Connected apps.

On Apps, search a provider, choose an account alias and supply an API key/token or
your own OAuth client where supported. Catalog fields and setup steps appear where
available. Added and Signed in are distinct: Check sign-in uses provider validation.
A successful implementation check is not proof that every action works live.
Reconnect updates the alias. Remove deletes it. Each bot/account starts Off.

Chief exposes only `apps_search` and `apps_run` through a credential-free mailbox.
Reads run freely, acts ask first even in routines, and payments are off. The backend
rechecks per-account grants and consumes one-use approvals before dispatch. The
connector's direct MCP/admin/proxy interfaces are not mounted in a bot. Turn tools
require filesystem and network isolation. See [Connected apps](../docs/CONNECTED_APPS.md)
for complete policy, engine coverage, setup and remaining limitations.

## Offline tests

From `connector/server`:

```bash
TMPDIR=/tmp/con-w HOME=/tmp/con-w .venv/bin/python -m pytest -q --no-header -p no:cacheprovider tests
```

Tests provision temporary storage before imports and block external DNS/socket calls.
Bad-token validation uses deterministic HTTP 401 responses; explicit mock transports
are preserved. Backend integration tests run a connector process and a fake provider
HTTP server on loopback. No tests require real credentials or providers.

## Extending the catalog

Providers are registered in `server/app/providers/registry.py`. Built-in implementations live in `server/app/providers/builtins/` and share the base classes in `server/app/providers/base.py`.

To add a new provider action:

1. Define its stable action ID, display name, description, input JSON schema, and required scopes.
2. Implement its asynchronous `execute` method using the shared HTTP client and the provider credential passed to it.
3. Register it from the provider implementation and register the provider in the registry.
4. Add or update credential validation if the provider requires authentication.
5. Confirm the action schema works through both the REST API and MCP clients.

Provider actions are maintained in a unified catalog at `server/app/providers/actions_catalog.json`, partitioned by provider service ID for scalable expansion.

## Data and security notes

- Chief stores the database and key outside the checkout in `CONNECTOR_DATA_DIR`. See the integration setup below.
- Connection credentials and OAuth tokens are encrypted at rest with AES-256-GCM. The database alone is not sufficient to recover them; the encryption key must also be preserved securely.
- Outbound requests check resolved IP addresses and block private or internal destinations by default. The `CONNECTOR_ALLOW_PRIVATE_NETWORK` option relaxes some private-address blocking and should be used only in a controlled environment. Loopback, link-local, and metadata addresses remain blocked.
- Run logs keep bounded summaries of action inputs and outputs with sensitive credentials automatically redacted.
- **Authentication is enforced per route:**

  | Routes | Credential |
  | --- | --- |
  | `/api/*` (connections, runtime tokens, runs, stats, OAuth config and authorize) | Admin token |
  | `POST /v1/actions/{id}`, `POST /v1/proxy/{service}` | Runtime or admin token, plus action, connection, and proxy grants |
  | `POST /mcp`, `GET /mcp/tools` | Runtime or admin token (fail closed) |
  | `GET /v1/providers`, `GET /v1/actions`, `/health`, OAuth callback, `/api/auth/status` and `/api/auth/verify` | Public. These expose catalog metadata or the OAuth redirect, not credentials. |

- **Outbound HTTP / SSRF Defense**: All outbound provider calls execute through `GuardedTransport`, which validates target IP addresses and pins TCP connections directly to the vetted IP, preventing DNS rebinding (TOCTOU) attacks while preserving TLS SNI and certificate validation. Private subnets, loopback, link-local, and cloud metadata (e.g. AWS/GCP `169.254.169.254`) are strictly blocked.
- **Behind a reverse proxy**, set `CONNECTOR_EXPOSE_LOCAL_TOKEN=false`, bind the API to loopback or a private network, terminate TLS at the proxy, and rate-limit `/api/auth/verify`. The Chief entry point requires loopback-only binding.
- **Database Portability & Deployment**: Backed by SQLite async by default with auto-migration, with PostgreSQL supported via SQLAlchemy async and versioned Alembic migrations (`alembic upgrade head`). A single-instance deployment is recommended until distributed locking and replication coordination are configured across multiple instances.

## Tenancy

Every tenant-owned row (connections, OAuth state, runtime tokens, run logs, idempotency records) carries a
`tenant_id`. A self-hosted install uses a single `default` tenant, so nothing changes for you. The core
enforces the boundary on every query: services take `tenant_id` as a required argument, and a tenant id
only ever comes from the authenticated principal or from server-side state created for it (for example the
OAuth state record), never from request input.

- Connection names are unique per tenant, so two tenants can each have a `github` / `default` connection.
- OAuth client credentials a tenant supplies are stored per tenant. Credentials from the server
  environment belong to the operator and are used only by the `default` tenant.
- Unauthenticated visitors (only when `CONNECTOR_ALLOW_PUBLIC_ACCESS` is turned on; it is off by default) live in a separate `public` tenant
  and never see the operator's data.
- A multi-user or hosted layer plugs in through two hooks in `app.core.tenancy`:
  `register_principal_resolver(...)` maps its own credentials (API keys, sessions) to a `Principal` with a
  `tenant_id` (kind `tenant_admin` for the management API, `runtime` for agents), and
  `register_token_extractor(...)` lets it read a credential from somewhere other than the standard headers
  (for example a session cookie). A resolver can raise a 401 for a credential it recognises but finds invalid,
  so that request never falls back to the public sandbox. Platform-wide hosted OAuth credentials remain
  operator-only. The open core itself has no user accounts: it is meant for your own agents, with the admin token
  and scoped runtime tokens.

`server/tests/test_tenant_isolation.py` is the contract: two tenants, the operator, and anonymous visitors
try to reach each other's data through every route.

## License

Open Agent Connector is licensed under the [Apache License 2.0](LICENSE). Unless you state otherwise, any
contribution you submit for inclusion is licensed under the same terms (section 5 of the license).
