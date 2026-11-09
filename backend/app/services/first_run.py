"""Local-only discovery and atomic, idempotent first-agent creation."""
import asyncio

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models import Agent
from app.db.transactions import begin_write
from app.services import engine_config, onboarding
from app.services.engine_registry import run_probe

CLI_ORDER = ('claude', 'codex', 'gemini', 'cursor', 'opencode', 'antigravity', 'acp')
LOCAL_URLS = ('http://127.0.0.1:11434/v1', 'http://127.0.0.1:1234/v1')


async def discover(rt, transport=None):
    """Never call configured remote APIs. CLI probes own their authentication checks."""
    ready = []

    async def cli(key):
        adapter = rt.adapters.get(key)
        if adapter is None:
            return None
        await rt.prepare_adapter(key, adapter)
        probe = await run_probe(adapter, 8)
        if not probe.ready or (key in ('claude', 'codex') and probe.signed_in is False):
            return None
        model = next((m.id for m in probe.models or [] if m.default), None)
        return {'provider': key, 'model': model, 'label': getattr(adapter, 'label', key)}

    results = await asyncio.gather(*(cli(key) for key in CLI_ORDER))
    ready.extend(result for result in results if result)
    # Configured API means address/model already supplied by the owner. Do not
    # probe it: opening the app must not contact a non-local address.
    for key in ('openrouter', 'openai_compat'):
        if key not in rt.adapters:
            continue
        async with rt.session() as db:
            config = await engine_config.load(db, rt.owner_id, key)
        if config and config.get('model') and config.get('base_url') and (key != 'openrouter' or config.get('api_key')):
            ready.append({'provider': key, 'model': config['model'], 'label': rt.adapters[key].label})
    if ready:
        return ready, None
    if 'openai_compat' not in rt.adapters:
        return [], None
    # IP literals, no redirects, no environment proxy, fixed ports only.
    async with httpx.AsyncClient(timeout=2, transport=transport, trust_env=False, follow_redirects=False) as client:
        for base in LOCAL_URLS:
            try:
                async with client.stream('GET', base + '/models') as response:
                    if response.status_code != 200:
                        continue
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 100_000:
                            raise ValueError('Local model catalog too large')
                    import json
                    data = json.loads(body)
                for entry in data.get('data', [])[:200]:
                    model = entry.get('id') if isinstance(entry, dict) else None
                    if not isinstance(model, str):
                        continue
                    config = rt.adapters['openai_compat'].validate_config({'base_url': base, 'model': model}, None)
                    return [{'provider': 'openai_compat', 'model': model, 'label': 'Local model'}], config
            except (httpx.HTTPError, ValueError, TypeError, AttributeError):
                continue
    return [], None


async def detect(rt, transport=None):
    from app.services.starter_team import upgrade
    await upgrade(rt)
    async with rt.session() as db:
        state, existing = await onboarding.load(db, rt.owner_id)
    if existing or (state and state['status'] != 'pending'):
        return state, []
    choices, local_config = await discover(rt, transport)
    if not choices:
        return state, []
    selected = choices[0]
    # Save a discovered local endpoint only if the person has never configured
    # this engine. A failed configured endpoint is never silently overwritten.
    if local_config:
        async with rt.session() as db:
            if await engine_config.load(db, rt.owner_id, 'openai_compat'):
                return state, []
            await engine_config.save(db, rt.owner_id, 'openai_compat', local_config)
        rt.engines.forget('openai_compat')
    async with rt.session() as db:
        await begin_write(db)
        row = await onboarding.locked_row(db, rt.owner_id)
        existing = await db.scalar(select(Agent.id).where(Agent.owner_id == rt.owner_id).limit(1))
        state = dict(row.value_json) if row else onboarding.fresh_state(existing_agents=existing is not None)
        if existing is not None or state['status'] != 'pending':
            await db.rollback()
            return state, choices
        from app.services.starter_team import CHIEF_INSTRUCTIONS
        from app.team.service import set_lead
        agent = Agent(owner_id=rt.owner_id, name='Chief', instructions=CHIEF_INSTRUCTIONS,
                      provider=selected['provider'], model=selected['model'], approval_mode='ask')
        db.add(agent)
        try:
            await db.flush()
            await set_lead(db, rt.owner_id, agent.id, commit=False)
            draft = {**onboarding.DEFAULT_DRAFT, 'name': 'Chief', 'purpose': agent.instructions,
                     'provider': selected['provider'], 'model': selected['model']}
            state.update(version=state['version'] + 1, status='configured', agent_id=agent.id, draft=draft,
                         receipt_draft=draft, auto_created=True)
            db.add(onboarding.persist(row, rt.owner_id, state))
            await db.commit()
        except IntegrityError:
            await db.rollback()
            state, _ = await onboarding.load(db, rt.owner_id)
    return state, choices
