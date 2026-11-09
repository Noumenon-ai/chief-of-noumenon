"""Hold non-urgent feed entries and replace each quiet interval with one summary."""
from datetime import UTC, datetime, timedelta
from sqlalchemy import select
from app.db.models import AppSetting, Notification, RoutineRun
from app.db.transactions import begin_write
from app.services import chief_preferences as prefs
from app.services.quiet_hours import quiet_until

URGENT = frozenset(('inbox_urgent', 'routine_needs_input', 'needs_input', 'approval', 'quiet_summary'))


def held_until(options, notice):
    if notice.kind in URGENT or notice.created_at is None:
        return None
    enabled_at = options.get('quiet_enabled_at')
    if enabled_at and notice.created_at < datetime.fromisoformat(enabled_at):
        return None
    return quiet_until(options, notice.created_at)


async def held(db, options, notice):
    if notice.run_id:
        run = await db.get(RoutineRun, notice.run_id)
        if run and run.trigger == 'manual':
            return None
    return held_until(options, notice)


async def visible(db, owner, notices):
    options = await prefs.get(db, owner)
    # Held originals are retained for audit; the summary is the visible delivery.
    return [n for n in notices if not await held(db, options, n)]


async def summarize(session, owner, now):
    from app.services import notification_feed
    async with session() as db:
        await begin_write(db)
        options = await prefs.get(db, owner)
        if not options.get('quiet_enabled'):
            return
        notices = list(await db.scalars(select(Notification).where(Notification.owner_id == owner,
            Notification.created_at >= datetime.fromisoformat(options.get('quiet_enabled_at', (now - timedelta(days=8)).isoformat())))))
        groups = {}
        for notice in notices:
            until = await held(db, options, notice)
            if until and until <= now:
                groups.setdefault(until.isoformat(), []).append(notice)
        for end, items in groups.items():
            section = 'quiet_summary.' + end
            if await db.get(AppSetting, prefs.key(owner, section)):
                continue
            body = '\n'.join(n.title + (': ' + n.body if n.kind == 'reminder' and n.body else '') for n in items)
            notification_feed.add(db, owner_id=owner, kind='quiet_summary', title=f'Quiet mode ended: {len(items)} updates', body=body)
            await prefs.put_value(db, owner, section, {'count': len(items)})
        await db.commit()
