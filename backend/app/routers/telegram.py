"""Owner preferences only. Telegram chat never calls this configuration path."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from app.core.config import settings
from app.routers.threads import get_runtime
from app.services.local_access_policy import require_local_access
from app.telegram_bot import preferences

router = APIRouter(prefix='/telegram', tags=['Telegram'], dependencies=[Depends(require_local_access)])

class Choice(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    lead_agent: int | None = Field(default=None, gt=0)

@router.get('')
async def read(rt=Depends(get_runtime)):
    prefs = await preferences(rt)
    return {'enabled': bool(settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_OWNER_ID), 'lead_agent': prefs.get('lead_agent')}

@router.put('')
async def save(choice: Choice, rt=Depends(get_runtime)):
    from app.services.agent_store import get_agent
    if choice.lead_agent is not None:
        async with rt.session() as db:
            agent = await get_agent(db, choice.lead_agent)
        if agent is None or agent.owner_id != rt.owner_id or agent.archived_at is not None:
            raise HTTPException(422, 'Choose an active agent.')
    await preferences(rt, lead_agent=choice.lead_agent, selected_agent=choice.lead_agent, thread=None)
    return await read(rt)
