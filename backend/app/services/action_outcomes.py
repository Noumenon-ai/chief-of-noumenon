"""Durable dispatch uncertainty, without storing recipients or provider content."""
from datetime import UTC, datetime
import hashlib
import json
from app.db.models import AppSetting
from app.db.transactions import begin_write
from app.services import chief_preferences as prefs

MESSAGES = {
    'done': 'Done: the provider confirmed the action. This does not establish delivery or that anyone read it.',
    'failed': 'Failed: the request was refused; no action was confirmed.',
    'unknown': 'Outcome unknown: the action may have happened. Check the provider before asking the person whether to retry.',
}


PROVIDER_ERRORS = {
    'not_found': 'Not found: the provider could not find the requested resource. Check its identifier; this does not mean the connection is broken.',
    'permission_denied': 'No permission: the provider denied access to this resource.',
    'sign_in_expired': 'Sign-in expired or rejected: reconnect this account to continue.',
    'rate_limited': 'Rate limited: the provider asked us to wait before trying again.',
    'provider_down': 'Provider unavailable: its service could not complete the request.',
}


def provider_error(status):
    code = {401: 'sign_in_expired', 403: 'permission_denied', 404: 'not_found', 429: 'rate_limited'}.get(status)
    if status >= 500:
        code = 'provider_down'
    return code


def result(outcome, reason=None):
    message = MESSAGES[outcome]
    if reason in PROVIDER_ERRORS:
        message = PROVIDER_ERRORS[reason] if outcome == 'failed' else message + ' ' + PROVIDER_ERRORS[reason]
    return {'outcome': outcome, 'outcome_message': message,
            'report_instruction': 'Report this outcome exactly. Never describe unknown as success or failure. Never retry an unknown outcome without a new person approval.',
            **({'error': message} if outcome != 'done' else {})}


def section(args):
    return 'action.' + hashlib.sha256(json.dumps(args, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


async def previous_attempt(rt, args):
    async with rt.session() as db:
        row = await db.get(AppSetting, prefs.key(rt.owner_id, section(args)))
        return row.value_json if row else {}


async def previous(rt, args):
    return (await previous_attempt(rt, args)).get('outcome')


async def save(rt, args, outcome, turn_id=None):
    async with rt.session() as db:
        await begin_write(db)
        await prefs.put_value(db, rt.owner_id, section(args), {'outcome': outcome, 'turn_id': turn_id, 'recorded_at': datetime.now(UTC).isoformat()})
        await db.commit()


def fresh_retry(approval, previous):
    """A pre-approved card cannot disclose an outcome that happened later."""
    try:
        recorded = datetime.fromisoformat(previous['recorded_at'])
        return approval.created_at >= recorded and (approval.summary or '').startswith('Retry after UNKNOWN')
    except (KeyError, TypeError, ValueError):
        return False
