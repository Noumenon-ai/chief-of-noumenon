"""Backend-only loopback HTTP client. Credentials never enter engine launches."""
import asyncio
import json
import os
from urllib.parse import urlsplit

import httpx

from app.services import user_credential_service as credentials
from app.services import connector_policy as policy
from app.services.decision_log import redact
from app.services import action_outcomes

PROVIDER = "integration:local-connector"
_locks = {}
_dispatch_locks = {}


def owner_lock(owner):
    return _locks.setdefault(owner, asyncio.Lock())


def dispatch_lock(owner, identity):
    # Identical actions retain at-most-once/unknown-outcome serialization.
    # Unrelated calls do not share a provider-duration lock.
    import weakref
    if owner not in _dispatch_locks:
        _dispatch_locks[owner] = weakref.WeakValueDictionary()
    return _dispatch_locks[owner].setdefault(identity, asyncio.Lock())


class ConnectorError(ValueError):
    def __init__(self, message, outcome='failed', code=None):
        super().__init__(message)
        self.outcome = outcome
        self.code = code

    def public(self):
        value = {'error': str(self)}
        if self.code:
            value['code'] = self.code
        if self.code == 'sign_in_expired':
            value.update(connect_url='/apps', report_instruction='Offer a reconnect card with suggest_connect for this provider. Never request credentials in chat.')
        return value


SCAN_LIMIT = 24000


def safe(value, secret=None, depth=0, *, metadata=False):
    if depth > 10:
        return "[bounded]"
    if isinstance(value, dict):
        return {safe(str(k), secret, depth + 1, metadata=True)[:200]: "[redacted]" if not metadata and policy.SECRET.search(str(k)) else safe(v, secret, depth + 1, metadata=metadata)
                for k, v in list(value.items())[:100]}
    if isinstance(value, list):
        return [safe(v, secret, depth + 1, metadata=metadata) for v in value[:10000]]
    if isinstance(value, str):
        if secret:
            import base64
            from urllib.parse import quote
            for form in (secret, quote(secret, safe=""), base64.b64encode(secret.encode()).decode(), json.dumps(secret)[1:-1]):
                value = value.replace(form, "[redacted]")
        # Only the first 12000 characters are kept, so never scan far more than that.
        if len(value) > SCAN_LIMIT:
            return redact(value[:SCAN_LIMIT])[:-256][:12000]
        return redact(value)[:12000]
    return value


async def load(db, owner):
    saved = await credentials.get_decrypted(db, owner, PROVIDER)
    return json.loads(saved[0]) if saved else None


async def save(db, owner, token):
    await credentials.save_token(db, user_id=owner, provider=PROVIDER, file_path="-", plaintext=json.dumps({"token": token}))


async def grants(db, owner, agent_id):
    from app.db.models import Agent
    agent = await db.get(Agent, agent_id)
    if agent is None or agent.owner_id != owner or agent.archived_at is not None:
        return {}
    saved = await credentials.get_decrypted(db, owner, f"{PROVIDER}:grants:{agent_id}")
    raw = json.loads(saved[0]) if saved else {}
    return {key: value for key, value in raw.items() if value in ("read", "act")}


class Client:
    def __init__(self, token, base_url=None, transport=None):
        url = base_url or os.environ.get("CONNECTOR_URL", "http://127.0.0.1:8100")
        parsed = urlsplit(url)
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ConnectorError("Connector URL must be an HTTP loopback origin.")
        self.token = token
        self.http = httpx.AsyncClient(base_url=url, headers={"Authorization": "Bearer " + token},
                                      timeout=30, follow_redirects=False, trust_env=False, transport=transport)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *unused):
        await self.http.aclose()

    async def request(self, method, path, *, mail_body=False, **kwargs):
        try:
            async with self.http.stream(method, path, **kwargs) as response:
                if response.status_code >= 400:
                    if response.status_code == 401 and not path.startswith('/v1/actions/'):
                        raise ConnectorError('Connector authorization was rejected. Reconnect on the Apps page.')
                    code = action_outcomes.provider_error(response.status_code)
                    if code:
                        raise ConnectorError(action_outcomes.PROVIDER_ERRORS[code],
                                             'unknown' if response.status_code >= 500 else 'failed', code)
                    # Never relay provider error bodies, even when they claim to be safe.
                    raise ConnectorError("The connector refused this request; no action was confirmed.")
                if response.status_code >= 300:
                    raise ConnectorError("The connector returned an unexpected redirect.", "unknown")
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    content.extend(chunk)
                    if len(content) > 4_000_000:
                        raise ConnectorError("The connector response exceeded its size limit.", "unknown")
                body = await asyncio.to_thread(json.loads, content)
                if not isinstance(body, dict):
                    raise ConnectorError("The connector returned an invalid receipt.", "unknown")
                if body.get("success") is False:
                    status = body.get("status_code")
                    code = action_outcomes.provider_error(status) if isinstance(status, int) else None
                    if code:
                        raise ConnectorError(action_outcomes.PROVIDER_ERRORS[code], 'unknown' if status >= 500 else 'failed', code)
                    raise ConnectorError("The provider did not confirm the action.", "unknown")
                if path.startswith('/v1/actions/gmail.') and not mail_body:
                    # Scheduled summaries and administrative reads get metadata.
                    # Only the granted, live turn bridge opts into body text.
                    def without_body(value):
                        if isinstance(value, dict):
                            return {k: without_body(v) for k, v in value.items() if k not in ('messageText', 'raw', 'data', 'body', 'parts', 'html')}
                        if isinstance(value, list):
                            return [without_body(v) for v in value[:30]]
                        return value
                    body = {'data': await asyncio.to_thread(without_body, body.get('data', body))}
                # A large reply must not freeze the app for everyone while it is cleaned.
                return await asyncio.to_thread(safe, body.get("data", body), self.token,
                                               metadata=method == "GET" and path.startswith(("/v1/providers", "/v1/actions")))
        except (httpx.HTTPError, ValueError) as exc:
            if isinstance(exc, ConnectorError):
                raise
            raise ConnectorError("The local connector is unavailable. Start it and check the Apps page. A submitted action may have run; check before retrying.", "unknown") from None


async def client(db, owner):
    saved = await load(db, owner)
    if not saved:
        # Provisioned by the installer; import once into encrypted backend settings.
        # Only the backend reads this file. It is never an engine environment value.
        from pathlib import Path
        folder = os.environ.get("CONNECTOR_DATA_DIR")
        path = Path(folder).expanduser() / ".admin_token" if folder else None
        if path and path.is_file() and not path.is_symlink() and not path.stat().st_mode & 0o077:
            token = path.read_text().strip()
            if token:
                await save(db, owner, token)
                saved = {"token": token}
    if not saved:
        raise ConnectorError("Set up the local connector on the Apps page. Never paste credentials in chat.")
    return Client(saved["token"])
