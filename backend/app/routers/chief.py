"""Person-facing settings and reminders; never mounted as model configuration tools."""
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from app.auth.routes import require_admin
from app.routers.agents import get_runtime
from app.services.local_access_policy import require_local_access
from app.db.models import Routine
from app.db.transactions import begin_write
from app.services import chief_preferences as prefs, reminders, starter_team, daily_briefs, routine_schedule

router = APIRouter(prefix='/chief', tags=['Chief'], dependencies=[Depends(require_local_access), Depends(require_admin)])


class Preferences(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    timezone: str = Field(max_length=100)
    quiet_enabled: bool = False
    location: str = Field(default='', max_length=120)
    israel: bool = False

    @field_validator('timezone')
    @classmethod
    def zone(cls, value):
        try: ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError): raise ValueError('Choose a valid IANA time zone.') from None
        return value


class ReminderInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    text: str = Field(min_length=1, max_length=2000)
    request_id: str | None = Field(default=None, max_length=100)


class TemplateInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    agent_id: int = Field(gt=0)


class ScheduleInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    enabled: bool
    time: str = Field(pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')


@router.get('/preferences')
async def preferences(rt=Depends(get_runtime)):
    async with rt.session() as db:
        value = await prefs.get(db, rt.owner_id)
        return {k: value[k] for k in Preferences.model_fields}


@router.put('/preferences')
async def save_preferences(body: Preferences, rt=Depends(get_runtime)):
    if body.quiet_enabled and not body.location.strip():
        raise HTTPException(422, 'Enter your location and its time zone before enabling quiet mode.')
    async with rt.session() as db:
        await begin_write(db)
        previous = await prefs.get(db, rt.owner_id)
        value = body.model_dump()
        if value['quiet_enabled']:
            value['quiet_enabled_at'] = previous.get('quiet_enabled_at', datetime.now(UTC).isoformat())
        await prefs.put_value(db, rt.owner_id, 'preferences', value)
        await db.commit()
    return body


@router.post('/starter-team')
async def add_starter(rt=Depends(get_runtime)):
    try: return await starter_team.add(rt)
    except ValueError as exc: raise HTTPException(409, str(exc)) from None


@router.get('/reminders')
async def list_reminders(rt=Depends(get_runtime)):
    async with rt.session() as db:
        return await reminders.list_all(db, rt.owner_id)


@router.post('/reminders')
async def create_reminder(body: ReminderInput, rt=Depends(get_runtime)):
    async with rt.session() as db:
        return await reminders.create(db, rt.owner_id, body.text, body.request_id)


@router.delete('/reminders/{identifier}')
async def cancel_reminder(identifier: str, rt=Depends(get_runtime)):
    async with rt.session() as db:
        try: return await reminders.cancel(db, rt.owner_id, identifier)
        except LookupError: raise HTTPException(404, 'Reminder not found.') from None


@router.post('/routines')
async def install_routines(body: TemplateInput, rt=Depends(get_runtime)):
    async with rt.session() as db:
        try: return {'ids': await daily_briefs.install(db, rt.owner_id, body.agent_id)}
        except ValueError as exc: raise HTTPException(422, str(exc)) from None


@router.get('/routines')
async def list_routines(rt=Depends(get_runtime)):
    async with rt.session() as db:
        rows = await db.scalars(select(Routine).where(Routine.owner_id == rt.owner_id))
        result = []
        for r in rows:
            kind = await daily_briefs.program(db, r)
            if kind:
                result.append({'id': r.id, 'name': r.name, 'agent_id': r.agent_id, 'enabled': not r.paused,
                               'time': r.schedule_spec.get('time', '09:00'), 'kind': kind})
        return result


@router.put('/routines/{identifier}')
async def save_schedule(identifier: int, body: ScheduleInput, rt=Depends(get_runtime)):
    async with rt.session() as db:
        await begin_write(db)
        routine = await db.get(Routine, identifier, with_for_update=True)
        if not routine or routine.owner_id != rt.owner_id or not await daily_briefs.program(db, routine):
            raise HTTPException(404, 'Routine not found.')
        options = await prefs.get(db, rt.owner_id)
        routine.timezone, routine.paused = options['timezone'], not body.enabled
        routine.schedule_kind, routine.schedule_spec = 'weekdays', {'days': list(range(7)), 'time': body.time}
        routine.next_run_at = routine_schedule.next_after(routine.schedule_kind, routine.schedule_spec, routine.timezone, datetime.now(UTC)) if body.enabled else None
        routine.uninterrupted_access, routine.approval_mode = False, 'plan'
        await db.commit()
    return {'saved': True}


# These settings are deliberately absent from the model tool catalog.
from app.services import contact_lookup, post_drafts


@router.get('/contact-aliases')
async def contact_aliases(rt=Depends(get_runtime)):
    async with rt.session() as db:
        return await contact_lookup.aliases(db, rt.owner_id)


@router.put('/contact-aliases')
async def save_aliases(body: contact_lookup.AliasList, rt=Depends(get_runtime)):
    async with rt.session() as db:
        await begin_write(db)
        await prefs.put_value(db, rt.owner_id, 'contact_aliases', [c.model_dump() for c in body.contacts])
        await db.commit()
    return {'saved': True}


@router.get('/post-drafts')
async def drafts(rt=Depends(get_runtime)):
    async with rt.session() as db:
        return await post_drafts.list_all(db, rt.owner_id)


@router.post('/post-drafts/check')
async def check_draft(body: post_drafts.DraftInput, rt=Depends(get_runtime)):
    async with rt.session() as db:
        return post_drafts.check(body.text, body.networks, await post_drafts.list_all(db, rt.owner_id))


@router.post('/post-drafts')
async def create_draft(body: post_drafts.DraftInput, rt=Depends(get_runtime)):
    async with rt.session() as db:
        try: return await post_drafts.save(db, rt.owner_id, body)
        except ValueError as exc: raise HTTPException(422, str(exc)) from None


@router.put('/post-drafts/{identifier}')
async def edit_draft(identifier: str, body: post_drafts.DraftInput, rt=Depends(get_runtime)):
    async with rt.session() as db:
        try: return await post_drafts.save(db, rt.owner_id, body, identifier)
        except LookupError: raise HTTPException(404, 'Draft not found.') from None


@router.delete('/post-drafts/{identifier}')
async def remove_draft(identifier: str, rt=Depends(get_runtime)):
    async with rt.session() as db:
        try: await post_drafts.remove(db, rt.owner_id, identifier)
        except LookupError: raise HTTPException(404, 'Draft not found.') from None
    return {'removed': True}


@router.post('/welcome')
async def first_chat(rt=Depends(get_runtime)):
    from app.services import chat_cards
    return await chat_cards.welcome(rt)
