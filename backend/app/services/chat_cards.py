"""Conversation suggestions are data, never approval or configuration authority."""
import re
import unicodedata
from uuid import uuid4
from sqlalchemy import select
from app.db.models import Agent, AppSetting, Event, Thread
from app.db.transactions import begin_write
from app.services import chief_preferences as prefs, connector_policy as policy, connector_service as connector
from app.services import thread_store as store

from app.services.chat_card_schema import TOOLS, NOTE, definitions


def normalize_call_number(value):
    if not isinstance(value, str) or len(value) > 64 or not re.fullmatch(r'\+?[0-9 ().-]+', value):
        raise ValueError('phone_number must contain only ASCII digits, an optional leading +, spaces, dashes, dots or parentheses; no extensions or pause characters.')
    number = re.sub(r'[ ().-]', '', value)
    if not re.fullmatch(r'\+?[0-9]{7,15}', number):
        raise ValueError('phone_number must have 7 to 15 digits after formatting is removed. Short codes must be dialed by the owner.')
    return number


def validate_call(args):
    if not isinstance(args, dict):
        raise ValueError('prepare_call requires an object with phone_number, name, purpose and talking_points.')
    number = normalize_call_number(args.get('phone_number'))

    def field(key, value, limit, required=True):
        if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
            raise ValueError(f'{key} must be {"a non-empty" if required else "a"} string of at most {limit} characters.')
        if any(unicodedata.category(ch) in ('Cc', 'Cf', 'Cs') for ch in value):
            raise ValueError(f'{key} must not contain control characters.')

    field('name', args.get('name'), 80)
    field('purpose', args.get('purpose'), 200)
    points = args.get('talking_points')
    if not isinstance(points, list) or not 1 <= len(points) <= 6:
        raise ValueError('talking_points must be a list of 1 to 6 short strings, each at most 160 characters.')
    for point in points:
        field('talking_points', point, 160)
    if 'details' in args:
        field('details', args['details'], 300, required=False)
    return {**args, 'phone_number': number}


def validate(name, args):
    from app.community_mcp import McpError, validate_arguments
    definition = next((d for d in definitions() if d['name'] == name), None)
    if definition is None:
        raise ValueError('Unknown chat card.')
    if name == 'prepare_call':
        args = validate_call(args)
    try:
        validate_arguments(definition['inputSchema'], args)
    except McpError:
        raise ValueError('This card has invalid fields.') from None
    policy.validate_input(args)
    if name == 'suggest_connect' and not re.fullmatch(r'[a-z0-9_-]{1,200}', args['provider']):
        raise ValueError('Choose an app from the local catalog.')
    return args


async def provider(db, owner, identifier):
    if not isinstance(identifier, str) or not re.fullmatch(r'[a-z0-9_-]{1,200}', identifier) or policy.blocked(identifier):
        raise ValueError('This app is unavailable.')
    async with await connector.client(db, owner) as client:
        catalog = await client.request('GET', '/v1/providers')
    found = next((p for p in catalog if p['service'] == identifier), None)
    if found is None:
        raise ValueError('Choose an app from the local catalog.')
    # A card offers connection, never a payment operation. Fully blocked providers
    # are refused above; payment actions remain refused by connector_policy.
    return found


async def add(db, thread_id, data, turn_id=None):
    card = {'id': uuid4().hex, **data}
    await store._add_event(db, thread_id, 'chat.card', card, turn_id)
    return card


async def suggest(rt, run, name, args):
    args = validate(name, args)
    if run.ctx.aborted or run.ctx.draft_only or run.ctx.media_review_only or not getattr(run.ctx, 'chat_cards_allowed', False):
        raise ValueError('This turn cannot suggest cards.')
    async with rt.session() as db:
        app = await provider(db, rt.owner_id, args['provider']) if name == 'suggest_connect' else None
        await begin_write(db)
        thread = await db.get(Thread, run.thread_id, with_for_update=True)
        if thread is None or thread.owner_id != rt.owner_id or thread.agent_id != run.agent_id:
            raise ValueError('Conversation not found.')
        if name == 'offer_daily_brief':
            section = 'brief_offer'
            if await db.get(AppSetting, prefs.key(rt.owner_id, section)):
                return {'shown': False, 'message': 'Already offered. Do not offer again.'}
            await prefs.put_value(db, rt.owner_id, section, {'offered': True})
            card = {'kind': 'brief'}
        elif name == 'prepare_call':
            card = {'kind': 'call', **args}
        elif app:
            card = {'kind': 'connect', 'provider': app['service'], 'name': app['displayName']}
        else:
            card = {'kind': 'question', **args}
        # Recorder checks the running lease before persistence; no credential fields
        # are accepted by the schema, and no caller can manufacture an answer.
        await db.commit()
    card['id'] = uuid4().hex
    if not await run.recorder.emit('chat.card', card):
        raise ValueError('This turn ended.')
    return {'shown': True, 'message': 'End this turn. Wait for the person’s reply; this card grants nothing.'}


async def request_connect(rt, thread_id, identifier):
    """A person's explicit request can show a card without an engine turn."""
    async with connector.dispatch_lock(rt.owner_id, "chat-cards"):
        async with rt.session() as db:
            app = await provider(db, rt.owner_id, identifier)
            await begin_write(db)
            thread = await db.get(Thread, thread_id, with_for_update=True)
            if not thread or thread.owner_id != rt.owner_id or thread.kind != 'chat':
                raise LookupError('Conversation not found.')
            if await store.running_turn_id(db, thread_id):
                raise ValueError('Wait for the bot to finish.')
            await store._add_event(db, thread_id, 'user.message', {'text': f"Connect {app['displayName']}"}, None)
            await add(db, thread_id, {'kind': 'connect', 'provider': app['service'], 'name': app['displayName']})
            await db.commit()
    rt.hub.notify(thread_id)
    return {'shown': True}


async def pending(db, thread_id, identifier):
    events = (await db.scalars(select(Event).where(Event.thread_id == thread_id, Event.type.in_(['chat.card', 'chat.card.answered'])).order_by(Event.seq))).all()
    card = next((e.data for e in events if e.type == 'chat.card' and e.data.get('id') == identifier), None)
    if card is None:
        raise LookupError('Card not found.')
    if any(e.type == 'chat.card.answered' and e.data.get('id') == identifier for e in events):
        raise ValueError('This card has already been answered.')
    return card


async def answer_event(db, thread_id, identifier, answer, turn_id=None):
    await pending(db, thread_id, identifier)
    await store._add_event(db, thread_id, 'chat.card.answered', {'id': identifier, 'answer': answer}, turn_id)


async def welcome(rt):
    """Claim and create the first greeting together; existing chats exclude an install."""
    async with connector.dispatch_lock(rt.owner_id, "chat-cards"):
        async with rt.session() as db:
            await begin_write(db)
            marker = await db.get(AppSetting, prefs.key(rt.owner_id, 'welcome'))
            if marker:
                return {'thread_id': None}
            existing = await db.scalar(select(Thread.id).where(Thread.owner_id == rt.owner_id).limit(1))
            if existing:
                await prefs.put_value(db, rt.owner_id, 'welcome', {'existing': True})
                await db.commit()
                return {'thread_id': None}
            from app.db.models import Team
            team = await db.scalar(select(Team).where(Team.owner_id == rt.owner_id))
            agent = await db.get(Agent, team.lead_agent_id) if team and team.lead_agent_id else None
            if agent is None or agent.archived_at:
                # The first-run wizard allows a single helper without a team.
                # Greet from that helper without silently granting it team authority.
                agent = await db.scalar(select(Agent).where(Agent.owner_id == rt.owner_id, Agent.archived_at.is_(None)).order_by(Agent.id).limit(1))
            if agent is None:
                return {'thread_id': None}
            thread = await rt.create_thread(agent_id=agent.id, db=db)
            await add(db, thread.id, {'kind': 'welcome', 'name': agent.name})
            await prefs.put_value(db, rt.owner_id, 'welcome', {'thread_id': thread.id})
            await db.commit()
            return {'thread_id': thread.id}


async def respond(rt, thread_id, identifier, choice, connection_id=None, timezone=None, *, admin=False):
    from datetime import UTC, datetime
    from zoneinfo import ZoneInfo
    from app.db.models import Routine
    from app.services import daily_briefs, routine_schedule
    # Serialize person answers, including connection rechecks, without changing grants.
    async with connector.dispatch_lock(rt.owner_id, "chat-cards"):
        async with rt.session() as db:
            thread = await db.get(Thread, thread_id)
            if not thread or thread.owner_id != rt.owner_id or thread.kind != 'chat':
                raise LookupError('Conversation not found.')
            card = await pending(db, thread_id, identifier)
            if await store.running_turn_id(db, thread_id):
                raise ValueError('Wait for the bot to finish before answering.')
            kind = card['kind']
            if kind not in ('question', 'call') and not admin:
                raise PermissionError('Open this card in your owner browser.')
            if kind == 'question':
                if choice is None or choice < 0 or choice >= len(card['options']):
                    raise ValueError('Choose one of the answers.')
                answer = card['options'][choice]
            elif kind == 'call':
                if choice not in (0, 1):
                    raise ValueError('Choose Done or Didn\'t reach them.')
                answer = 'Done' if choice == 0 else "Didn't reach them"
            elif kind == 'connect':
                await provider(db, rt.owner_id, card['provider'])
                grants = await connector.grants(db, rt.owner_id, thread.agent_id)
                async with await connector.client(db, rt.owner_id) as client:
                    accounts = await client.request('GET', '/api/connections')
                if not any(c['id'] == connection_id and c['service'] == card['provider'] and c.get('status') in ('active', 'added') for c in accounts) or connection_id not in grants:
                    raise ValueError('Connect this account and save access for this bot first.')
                answer = f"I connected {card['name']} and saved this bot’s access. Continue my original request."
            elif kind == 'welcome':
                if choice not in (0, 1, 2, -1):
                    raise ValueError('Choose an answer.')
                answer = {0: 'Connect Gmail', 1: 'Set up a daily brief', 2: 'Just chat', -1: 'Dismissed'}[choice]
                if choice == 0:
                    await provider(db, rt.owner_id, 'gmail')
            elif kind == 'brief':
                if choice not in (0, 1):
                    raise ValueError('Choose an answer.')
                answer = 'Every morning at 8' if choice == 0 else 'Not now'
                if choice == 0:
                    try:
                        ZoneInfo(timezone)
                    except (ValueError, TypeError, KeyError):
                        raise ValueError('Choose your time zone in Your day.') from None
                    # Existing templates are installed paused; only the explicit tap
                    # enables morning below. A failed answer cannot enable a routine.
                    grants = await connector.grants(db, rt.owner_id, thread.agent_id)
                    try:
                        async with await connector.client(db, rt.owner_id) as client:
                            accounts = await client.request('GET', '/api/connections')
                    except connector.ConnectorError:
                        accounts = []
                    connected_apps = {c['service'] for c in accounts if c.get('status') in ('active', 'added') and c['id'] in grants}
                    ids = await daily_briefs.install(db, rt.owner_id, thread.agent_id)
                    morning = None
                    for rid in ids:
                        if await daily_briefs.program(db, await db.get(Routine, rid)) == 'morning':
                            morning = rid
                            break
            else:
                raise ValueError('Unknown card.')
        if kind in ('question', 'connect', 'call'):
            # The card answer and new turn are persisted in one transaction. A
            # double tap, reconnect or concurrent request can start only one turn.
            await rt.send_turn(thread_id, answer, card_answer=(identifier, answer), configuration_allowed=admin)
        else:
            async with rt.session() as db:
                await begin_write(db)
                await db.get(Thread, thread_id, with_for_update=True)
                await pending(db, thread_id, identifier)
                if kind == 'brief' and choice == 0:
                    routine = await db.get(Routine, morning, with_for_update=True)
                    routine.timezone, routine.paused = timezone, False
                    routine.schedule_kind, routine.schedule_spec = 'weekdays', {'days': list(range(7)), 'time': '08:00'}
                    routine.next_run_at = routine_schedule.next_after('weekdays', routine.schedule_spec, timezone, datetime.now(UTC))
                    routine.uninterrupted_access, routine.approval_mode = False, 'plan'
                    await prefs.put_value(db, rt.owner_id, 'brief_offer', {'offered': True})
                    for app_id, name in [('gmail', 'Gmail'), ('googlecalendar', 'Google Calendar')]:
                        if app_id not in connected_apps and not policy.blocked(app_id):
                            await add(db, thread_id, {'kind': 'connect', 'provider': app_id, 'name': name, 'brief': True})
                if kind == 'welcome' and choice in (0, 1):
                    await add(db, thread_id, {'kind': 'connect', 'provider': 'gmail', 'name': 'Gmail'} if choice == 0 else {'kind': 'brief'})
                    if choice == 1:
                        await prefs.put_value(db, rt.owner_id, 'brief_offer', {'offered': True})
                await answer_event(db, thread_id, identifier, answer)
                await db.commit()
        rt.hub.notify(thread_id)
        return {'answered': True}
