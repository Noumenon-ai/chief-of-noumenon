"""Owner-only private phone setup; cookie calls include CSRF, including status."""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import credentials, store
from app.auth.limiter import RateLimit
from app.auth.routes import require_admin, require_json, _error
from app.auth.policy import Principal
from app.core.public_url import pairing_link
from app.db.session import get_db
from app.services import phone_access

requests = RateLimit(limit=20, window_seconds=60)


def limit():
    if not requests.allow("phone"):
        raise HTTPException(429, "Too many checks. Wait a minute and try again.", headers={"Retry-After": "60"})


def owner(principal: Principal = Depends(require_admin)):
    if principal.tenant_id is not None or principal.kind not in ("browser", "device", "loopback"):
        raise HTTPException(403, "Only this server's owner can set up phone access.")
    return principal


router = APIRouter(prefix="/phone", tags=["Phone"], dependencies=[Depends(owner), Depends(require_json), Depends(limit)])


def no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"


@router.post("/status")
async def status(response: Response):
    no_cache(response)
    return await phone_access.run()


@router.post("/on")
async def turn_on(response: Response):
    no_cache(response)
    return await phone_access.run("on")


@router.post("/off")
async def turn_off(response: Response):
    no_cache(response)
    return await phone_access.run("off")


@router.post("/pairing-code")
async def code(response: Response, db: AsyncSession = Depends(get_db)):
    no_cache(response)
    current = await phone_access.run()
    if current["state"] != "on":
        raise HTTPException(409, "Turn on the private phone link first.")
    try:
        secret, record = await store.create_pairing_code(db, label="My phone", scope="chat")
    except store.TooManyOpenCodes:
        raise _error(429, "too_many_codes", "Use the current code or wait five minutes before making another.") from None
    return {"url": pairing_link(current["address"], credentials.format_pairing_code(secret)), "expires_at": record.expires_at}
