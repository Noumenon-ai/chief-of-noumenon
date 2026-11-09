import asyncio
from types import SimpleNamespace
import httpx
import pytest
from sqlalchemy import select

from app.db.models import Agent
from app.services import first_run, agent_store
from app.services.provider_adapter import EngineProbe
from app.services.openai_chat_adapter import OpenAIChatAdapter
from tests.routers.test_onboarding_api import api  # noqa: F401
from tests.services.thread_harness import sessions, owner, rt, cleanup  # noqa: F401


@pytest.mark.parametrize('choices', [[], [{'provider': 'claude', 'model': None, 'label': 'Claude'}]])
async def test_detect_idempotent(api, rt, sessions, owner, monkeypatch, choices):
    async def discover(*args): return choices, None
    monkeypatch.setattr(first_run, 'discover', discover)
    responses = await asyncio.gather(*(api.post('/api/v1/onboarding/detect') for _ in range(3)))
    assert all(r.status_code == 200 for r in responses)
    async with sessions() as db:
        agents = (await db.scalars(select(Agent).where(Agent.owner_id == owner))).all()
    assert len(agents) == bool(choices)
    if agents:
        assert agents[0].name == 'Chief' and agents[0].approval_mode == 'ask'
        assert len({r.json()['agent_id'] for r in responses}) == 1


async def test_existing_agent_never_probed_or_overwritten(api, rt, sessions, owner, monkeypatch):
    async with sessions() as db:
        saved = await agent_store.create_agent(db, owner_id=owner, name='Mine', provider='claude')
    async def fail(*args): raise AssertionError('must not probe')
    monkeypatch.setattr(first_run, 'discover', fail)
    assert (await api.post('/api/v1/onboarding/detect')).status_code == 200
    async with sessions() as db:
        agent = await db.get(Agent, saved.id)
        assert agent.name == 'Mine'


async def test_priority_and_no_remote_api_probe(rt, monkeypatch):
    async def probe(adapter, timeout): return EngineProbe(True, True, signed_in=True)
    monkeypatch.setattr(first_run, 'run_probe', probe)
    async def prepare(*args): return None
    rt.prepare_adapter = prepare
    async def config(*args): return {'base_url': 'https://remote.invalid/v1', 'model': 'fake'}
    monkeypatch.setattr(first_run.engine_config, 'load', config)
    rt.adapters = {key: SimpleNamespace(label=key) for key in ('openai_compat', 'codex', 'claude', 'gemini', 'antigravity')}
    found, config = await first_run.discover(rt, httpx.MockTransport(lambda r: pytest.fail('No HTTP allowed when a CLI is ready')))
    assert [r['provider'] for r in found] == ['claude', 'codex', 'gemini', 'antigravity', 'openai_compat']


async def test_local_discovery_uses_fixed_addresses_only(rt, monkeypatch):
    rt.adapters = {'openai_compat': OpenAIChatAdapter()}
    async def config(*args): return None
    monkeypatch.setattr(first_run.engine_config, 'load', config)
    seen = []
    def response(request):
        seen.append(str(request.url))
        return httpx.Response(200, json={'data': [{'id': 'local-model'}]})
    found, config = await first_run.discover(rt, httpx.MockTransport(response))
    assert seen == ['http://127.0.0.1:11434/v1/models']
    assert found[0]['model'] == 'local-model'
    assert config['base_url'] == 'http://127.0.0.1:11434/v1'


async def test_local_redirect_not_followed(rt, monkeypatch):
    rt.adapters = {'openai_compat': OpenAIChatAdapter()}
    async def config(*args): return None
    monkeypatch.setattr(first_run.engine_config, 'load', config)
    def response(request):
        assert request.url.host == '127.0.0.1'
        return httpx.Response(302, headers={'location': 'https://evil.invalid'})
    assert await first_run.discover(rt, httpx.MockTransport(response)) == ([], None)
