"""Durable personal reminders and atomic notification creation; never log content."""
import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from sqlalchemy import select
from app.db.models import AppSetting
from app.db.transactions import begin_write
from app.services import chief_preferences as prefs, notification_feed
from app.services.reminder_parser import parse

TOOLS = ('create_reminder', 'list_reminders', 'cancel_reminder')


async def list_all(db, owner):
    rows = await db.scalars(select(AppSetting).where(AppSetting.key.startswith(prefs.key(owner, 'reminder.'))))
    return sorted([r.value_json for r in rows], key=lambda r: r['due_at'])


async def create(db, owner, text, request_id=None, now=None):
    options = await prefs.get(db, owner)
    result = parse(text, options['timezone'], now)
    if 'question' in result:
        return result
    identifier = hashlib.sha256(request_id.encode()).hexdigest() if request_id else uuid.uuid4().hex
    await begin_write(db)
    row = await db.get(AppSetting, prefs.key(owner, 'reminder.' + identifier))
    if row:
        return row.value_json
    result.update(id=identifier, status='pending')
    await prefs.put_value(db, owner, 'reminder.' + identifier, result)
    await db.commit()
    return result


async def cancel(db, owner, identifier):
    await begin_write(db)
    row = await db.scalar(select(AppSetting).where(AppSetting.key == prefs.key(owner, 'reminder.' + identifier)).with_for_update())
    if not row:
        raise LookupError('Reminder not found.')
    if row.value_json['status'] == 'pending':
        row.value_json = {**row.value_json, 'status': 'cancelled'}
    await db.commit()
    return row.value_json


async def deliver_due(session, owner, now=None):
    now = now or datetime.now(UTC)
    texts = []
    async with session() as db:
        await begin_write(db)
        options = await prefs.get(db, owner)
        from app.services.quiet_hours import quiet_until
        rows = await db.scalars(select(AppSetting).where(AppSetting.key.startswith(prefs.key(owner, 'reminder.'))).with_for_update())
        for row in rows:
            value = row.value_json
            if value['status'] != 'pending' or datetime.fromisoformat(value['due_at']) > now:
                continue
            late = now - datetime.fromisoformat(value['due_at']) > timedelta(minutes=2)
            note = f"Due {value['time_label']}. Delivered late after the server was unavailable or quiet mode ended.\n" if late else ''
            notification = notification_feed.add(db, owner_id=owner, kind='reminder', title='Reminder', body=note + value['body'])
            due = datetime.fromisoformat(value['due_at'])
            notification.created_at = due if quiet_until(options, due) else now
            texts.append(notification_feed.telegram_text(notification))
            row.value_json = {**value, 'status': 'delivered', 'delivered_at': now.isoformat()}
        await db.commit()
    return texts


async def call(rt, run, name, args):
    # Reminder tools cannot be used by unattended work or retrieved instructions.
    if run.ctx.team.origin != 'person':
        return {'error': 'Personal reminders require a person-started conversation.'}
    async with rt.session() as db:
        if name == 'list_reminders':
            return {'reminders': await list_all(db, rt.owner_id)}
        if name == 'cancel_reminder':
            try:
                return await cancel(db, rt.owner_id, args['id'])
            except LookupError:
                return {'error': 'Reminder not found.'}
        request = f"{run.turn_id}:" + hashlib.sha256(args['text'].encode()).hexdigest()
        return await create(db, rt.owner_id, args['text'], request)
