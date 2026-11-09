"""Owner-only day planning settings. No credentials or model-editable permissions."""
import hashlib
import os
from pathlib import Path
from zoneinfo import ZoneInfo
from sqlalchemy import select
from app.db.models import AppSetting


def key(owner, section):
    return 'chief.v1.' + hashlib.sha256(owner.encode()).hexdigest() + '.' + section


def system_timezone():
    configured = os.environ.get('TZ', '').removeprefix(':')
    if configured:
        try:
            ZoneInfo(configured)
            return configured
        except (ValueError, KeyError):
            pass
    try:
        return str(Path('/etc/localtime').resolve()).split('/zoneinfo/')[1]
    except (IndexError, OSError):
        return 'UTC'


def defaults():
    return {'timezone': system_timezone(), 'quiet_enabled': False, 'location': '',
            'israel': False}


async def get(db, owner):
    row = await db.get(AppSetting, key(owner, 'preferences'))
    return {**defaults(), **(row.value_json if row else {})}


async def put_value(db, owner, section, value):
    row = await db.scalar(select(AppSetting).where(AppSetting.key == key(owner, section)).with_for_update())
    if row is None:
        row = AppSetting(key=key(owner, section), value_json=value, version=1, updated_by=owner)
        db.add(row)
    else:
        row.value_json = value
        row.version += 1
    return row
