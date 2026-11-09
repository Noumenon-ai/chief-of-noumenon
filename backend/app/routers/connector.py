"""Person-only local connector management. No grant or setup tool is mounted."""
import json
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from urllib.parse import urlsplit
import httpx
from app.core.config import settings
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Agent
from app.db.session import get_db
from app.routers.integrations import _owner
from app.services.local_access_policy import require_local_access
from app.services.thread_runtime import LOCAL_OWNER_ID
from app.services import connector_service as service, connector_policy as policy, user_credential_service

router = APIRouter(prefix="/integrations/connector", dependencies=[Depends(require_local_access), Depends(_owner)])


def identifier(value):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,200}", value):
        raise HTTPException(422, "Invalid app or connection ID")
    return value


async def body(request):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 16000:
            raise HTTPException(413, "Request too large")
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except ValueError:
        raise HTTPException(422, "Expected an object") from None


async def call(db, method, path, **kwargs):
    try:
        async with await service.client(db, LOCAL_OWNER_ID) as client:
            return await client.request(method, path, **kwargs)
    except service.ConnectorError as exc:
        raise HTTPException(503, str(exc)) from None


@router.get("")
async def catalog(response: Response, db: AsyncSession = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    providers = await call(db, "GET", "/v1/providers")
    accounts = await call(db, "GET", "/api/connections")
    oauth = await call(db, "GET", "/api/oauth/providers")
    return {"providers": [p for p in providers if not policy.blocked(p["service"])],
            "connections": [c for c in accounts if not policy.blocked(c["service"])], "oauth": oauth}


@router.put("/connections/{provider}")
async def connect(provider: str, request: Request, db: AsyncSession = Depends(get_db)):
    identifier(provider)
    if policy.blocked(provider):
        raise HTTPException(403, "This app is blocked by the owner")
    await known_provider(db, provider)
    payload = await body(request)
    if set(payload) != {"connectionName", "authType", "values"} or not isinstance(payload["values"], dict):
        raise HTTPException(422, "Supply an account alias, auth type and credential values")
    if not isinstance(payload["connectionName"], str) or not 1 <= len(payload["connectionName"]) <= 100:
        raise HTTPException(422, "Choose an account alias of 1 to 100 characters")
    return await call(db, "PUT", "/api/connections/" + provider, json=payload)


@router.post("/connections/{connection_id}/test")
async def test(connection_id: str, db: AsyncSession = Depends(get_db)):
    return await call(db, "POST", "/api/connections/" + identifier(connection_id) + "/test")


@router.delete("/connections/{connection_id}")
async def remove(connection_id: str, db: AsyncSession = Depends(get_db)):
    return await call(db, "DELETE", "/api/connections/" + identifier(connection_id))



async def known_provider(db, provider):
    providers = await call(db, "GET", "/v1/providers")
    if not any(p.get("service") == provider for p in providers):
        raise HTTPException(422, "Choose an app from the local catalog")


GOOGLE_APPS = frozenset({"gmail", "googlecalendar", "googledrive", "googlesheets", "googledocs", "googleslides", "googletasks", "googlemeet", "googlechat", "googleforms", "googlephotos", "youtube", "googleads", "googleanalytics", "googlecontacts", "googlebigquery", "googlesearchconsole"})


def google_client(client_id, secret):
    return (isinstance(client_id, str) and isinstance(secret, str)
            and re.fullmatch(r"[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com", client_id)
            and re.fullmatch(r"GOCSPX-[A-Za-z0-9_-]{20,}", secret))

@router.post("/oauth/{provider}")
async def oauth(provider: str, request: Request, db: AsyncSession = Depends(get_db)):
    identifier(provider)
    if policy.blocked(provider):
        raise HTTPException(403, "This app is blocked by the owner")
    await known_provider(db, provider)
    payload = await body(request)
    if set(payload) - {"clientId", "clientSecret", "connectionName", "subdomain", "returnUrl"} or not isinstance(payload.get("connectionName"), str) or not 1 <= len(payload["connectionName"]) <= 100:
        raise HTTPException(422, "Supply an account alias and your OAuth client")
    return_url = payload.get("returnUrl", str(request.base_url).rstrip("/") + "/apps/")
    if not allowed_return(return_url, request):
        raise HTTPException(422, "Return to the configured Apps page after signing in")
    client_id, secret = payload.get("clientId", ""), payload.get("clientSecret", "")
    if not isinstance(client_id, str) or not isinstance(secret, str) or bool(client_id.strip()) != bool(secret.strip()):
        raise HTTPException(422, "Enter both the client ID and secret, or leave both empty to use your saved client")
    client_id, secret = client_id.strip(), secret.strip()
    if client_id:
        if provider.replace("_", "").replace("-", "") in GOOGLE_APPS and not google_client(client_id, secret):
            raise HTTPException(422, "Paste the Web application client ID ending in .apps.googleusercontent.com and its secret starting with GOCSPX-")
        targets = ("gmail", "googlecalendar") if provider in ("gmail", "googlecalendar") else (provider,)
        for target in targets:
            await call(db, "POST", f"/api/oauth/{target}/config", json={"clientId": client_id, "clientSecret": secret, "subdomain": payload.get("subdomain"), "mode": "custom"})
    # Read directly: the normal reply cleaner hides fields named like credentials, and this
    # sign-in link is meant for the person's browser. It holds no client secret.
    try:
        async with service.dispatch_lock(LOCAL_OWNER_ID, "oauth:" + provider):
            async with await service.client(db, LOCAL_OWNER_ID) as client:
                response = await client.http.get(f"/api/oauth/{provider}/authorize", params={"connectionName": payload["connectionName"], "mode": "custom", "redirectUri": return_url})
    except httpx.HTTPError:
        raise HTTPException(503, "The local connector is unavailable. Start it and check the Apps page.") from None
    except service.ConnectorError as exc:
        raise HTTPException(503, str(exc)) from None
    if response.status_code != 200:
        raise HTTPException(503, "The connector could not start this sign-in. Check the OAuth client on the Apps page.")
    try:
        url = response.json()["data"]["authorization_url"]
    except (ValueError, KeyError, TypeError):
        url = ""
    if not isinstance(url, str) or not url.startswith("https://"):
        raise HTTPException(502, "The provider did not supply a secure sign-in URL")
    return {"url": url}


async def agent_owned(db, agent_id):
    agent = await db.get(Agent, agent_id)
    if agent is None or agent.owner_id != LOCAL_OWNER_ID or agent.archived_at is not None:
        raise HTTPException(404, "Bot not found")


@router.get("/grants/{agent_id}")
async def get_grants(agent_id: int, db: AsyncSession = Depends(get_db)):
    await agent_owned(db, agent_id)
    return await service.grants(db, LOCAL_OWNER_ID, agent_id)


@router.put("/grants/{agent_id}")
async def set_grants(agent_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    await agent_owned(db, agent_id)
    payload = await body(request)
    connections = await call(db, "GET", "/api/connections")
    allowed = {c["id"] for c in connections if not policy.blocked(c["service"])}
    if any(key not in allowed or level not in ("read", "act") for key, level in payload.items()):
        raise HTTPException(422, "Choose a connected account and Read only or Read and ask to act")
    async with service.owner_lock(LOCAL_OWNER_ID):
        await user_credential_service.save_token(db, user_id=LOCAL_OWNER_ID,
            provider=f"{service.PROVIDER}:grants:{agent_id}", file_path="-", plaintext=json.dumps(payload))
    return payload


def allowed_return(url, request):
    if not isinstance(url, str):
        return False
    parsed = urlsplit(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return (parsed.scheme in ("https", "http") and not parsed.username and not parsed.password
            and origin in {*settings.FRONTEND_ORIGIN_LIST, str(request.base_url).rstrip("/")}
            and parsed.path.rstrip("/") == "/apps")


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request, state: str = Query(max_length=1000),
                         code: str | None = Query(None, max_length=4096), error: str | None = Query(None, max_length=200),
                         db: AsyncSession = Depends(get_db)):
    identifier(provider)
    try:
        async with service.dispatch_lock(LOCAL_OWNER_ID, "oauth:" + provider):
            async with await service.client(db, LOCAL_OWNER_ID) as client:
                response = await client.http.post(f"/api/oauth/{provider}/complete", json={"state": state, "code": code, "error": error})
        if response.status_code in (302, 303, 307):
            destination = response.headers.get("location", "")
            if allowed_return(destination, request):
                # Do not forward provider error strings in redirects or browser history.
                parsed = urlsplit(destination)
                status = "connected" if "status=connected" in parsed.query else "error"
                return RedirectResponse(f"{parsed.scheme}://{parsed.netloc}{parsed.path}?status={status}", status_code=303)
        if response.status_code == 200:
            return RedirectResponse("/apps/?status=connected", status_code=303)
    except (httpx.HTTPError, service.ConnectorError):
        pass
    raise HTTPException(400, "Sign-in was not completed. Return to Apps and reconnect.")
