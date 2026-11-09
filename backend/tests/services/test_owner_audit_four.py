"""Owner audit regressions: fixtures only, no external providers or engines."""
import asyncio
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.db.models import Agent, AppSetting
from app.services import action_outcomes, agent_memory, agent_store, connector_service, onboarding, starter_team
from app.services.api_tools import Tools
from app.services.provider_adapter import TurnContext
from app.services.tool_policy import automatic
from tests.services.thread_harness import sessions, owner, rt, cleanup  # noqa: F401


@pytest.mark.parametrize('status,code,outcome', [(404,'not_found','failed'), (403,'permission_denied','failed'),
    (401,'sign_in_expired','failed'), (429,'rate_limited','failed'), (503,'provider_down','unknown')])
async def test_provider_errors_are_distinct_and_never_quote_content(status, code, outcome):
    secret = ''.join(['ghp_', 'x' * 32])
    transport = httpx.MockTransport(lambda request: httpx.Response(status, text='Private resource ' + secret))
    async with connector_service.Client('fixture', transport=transport) as client:
        with pytest.raises(connector_service.ConnectorError) as caught:
            await client.request('POST', '/v1/actions/test.get')
    error = caught.value
    assert error.code == code and error.outcome == outcome
    assert error.public()['error'] == action_outcomes.PROVIDER_ERRORS[code]
    assert secret not in json.dumps(error.public()) and 'Private resource' not in str(error)
    assert ('connect_url' in error.public()) == (status == 401)


async def test_large_reply_does_not_block_concurrent_http_request(monkeypatch):
    app = FastAPI()
    @app.get('/health')
    async def health():
        return {'ready': True}
    payload = {'data': {'text': 'a' * 3_000_000}}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=payload))
    original = connector_service.safe
    # Includes slow CPU/IO work in the result-cleaning boundary, deterministically.
    def slow(value, *args, **kwargs):
        time.sleep(.4)
        return original(value, *args, **kwargs)
    monkeypatch.setattr(connector_service, 'safe', slow)
    async with connector_service.Client('fixture', transport=transport) as client:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as web:
            start = time.monotonic()
            task = asyncio.create_task(client.request('POST', '/v1/actions/test.get'))
            try:
                await asyncio.sleep(.02)
                assert (await web.get('/health')).json() == {'ready': True}
                assert time.monotonic() - start < .25
                result = await task
                assert len(result['text']) <= 12000
            finally:
                await task


async def test_starter_upgrade_preserves_edited_instructions(rt, sessions, owner):
    from app.services import chief_preferences as prefs
    async with sessions() as db:
        chief = await agent_store.create_agent(db, owner_id=owner, name='Chief', instructions=starter_team.ORIGINAL_CHIEF_INSTRUCTIONS)
        inbox = await agent_store.create_agent(db, owner_id=owner, name='My inbox helper', instructions=starter_team.ROLES['Inbox'][1] + starter_team.SPECIALIST_SUFFIX)
        builder = await agent_store.create_agent(db, owner_id=owner, name='Builder', instructions='My edited instructions')
        db.add(AppSetting(key=onboarding.setting_key(owner), version=1, updated_by=owner, value_json={'auto_created': True, 'agent_id': chief.id}))
        db.add(AppSetting(key=prefs.key(owner, 'starter'), version=1, updated_by=owner, value_json={'created':['Inbox','Builder']}))
        await db.commit()
    await starter_team.upgrade(rt)
    await starter_team.upgrade(rt)
    async with sessions() as db:
        rows = {a.id:a.instructions for a in await db.scalars(select(Agent).where(Agent.owner_id == owner))}
    assert rows[chief.id] == starter_team.CHIEF_INSTRUCTIONS
    assert rows[inbox.id].endswith(starter_team.RESOURCEFULNESS)
    assert rows[builder.id] == 'My edited instructions'
    for retained in ('delegation', 'create_reminder', 'untrusted', 'approval'):
        assert retained in rows[chief.id]


async def test_read_tool_reaches_private_notes_from_custom_workspace(tmp_path, monkeypatch):
    from app.core import turn_sandbox
    from app.core.config import settings
    from app.services import local_claude_runner
    monkeypatch.setattr(local_claude_runner, 'workspace_dir', lambda: tmp_path / 'bots')
    monkeypatch.setattr(turn_sandbox, 'self_check', lambda: {'status':'off'})
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    agent_memory.write_memory(7, 'The project is an offline planner.')
    workspace = tmp_path / 'custom'; workspace.mkdir()
    ctx = TurnContext(thread_id=1, turn_id=1, prompt='draft', workspace=workspace, model=None,
        provider_session_id=None, provider_state=None, resume=False, history=AsyncMock(), agent_id=7)
    args = {'path': '__notes__/MEMORY.md'}
    assert automatic('api__read', 'ask', SimpleNamespace(ctx=ctx), args) == ('allowed', 'workspace_read')
    result = await Tools(ctx, None, None).local('read', args)
    assert 'offline planner' in json.dumps(result)
    assert 'file read and list tools' in starter_team.FILE_GUIDANCE
    assert 'ask_question' in starter_team.RESOURCEFULNESS
    assert 'never invent' in starter_team.RESOURCEFULNESS
    assert automatic('api__shell', 'ask', SimpleNamespace(ctx=ctx), {'command':'cat MEMORY.md'}) is None


async def test_mail_body_only_opted_in_by_live_read():
    data = {'messageText':'The deadline is Friday.', 'snippet':'Hello', 'payload':{'headers':[]}}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={'data': data}))
    async with connector_service.Client('fixture', transport=transport) as client:
        summary = await client.request('POST', '/v1/actions/gmail.get_message')
        detail = await client.request('POST', '/v1/actions/gmail.get_message', mail_body=True)
    assert 'messageText' not in summary
    assert detail['messageText'] == data['messageText']


def test_big_stream_tool_result_is_bounded_before_recording():
    from app.services.local_claude_stream import StreamNormalizer
    from app.services.thread_store import cap_tool_output
    normalizer = StreamNormalizer(max_text_bytes=1000)
    normalizer.feed(json.dumps({'type':'user','message':{'content':[{'type':'tool_result','tool_use_id':'read',
        'content':[{'type':'text','text':'x' * 2_000_000}]}]}}))
    event, = normalizer.take_tool_events()
    assert len(event.extra['output']) == 100001
    output, truncated = cap_tool_output(event.extra['output'])
    assert len(output) == 100000 and truncated


async def test_bounded_replay_keeps_complete_recent_turn_and_full_history(sessions, owner):
    from app.services import thread_store as store
    async with sessions() as db:
        thread = await store.create_thread(db, owner_id=owner, provider='claude')
        for seq in range(1, 10):
            await store.append_event(db, thread.id, 'turn.started' if seq in (1, 5) else 'assistant.message',
                                     {'prompt_text': f'Prompt {seq}'} if seq in (1, 5) else {'text': f'Reply {seq}'})
        bounded = await store.list_all_events(db, thread.id, page=2, max_events=6)
        complete = await store.list_all_events(db, thread.id, page=2)
    assert len(complete) == 9
    assert [event.seq for event in bounded] == [0, 5, 6, 7, 8, 9]
    assert 'Earlier history omitted' in bounded[0].data['text']
    assert bounded[1].type == 'turn.started'


async def test_upgrade_previous_unedited_card_guidance_only(rt, sessions, owner):
    from app.services import chief_preferences as prefs
    old_chief = starter_team.ORIGINAL_CHIEF_INSTRUCTIONS + ' ' + starter_team.PREVIOUS_RESOURCEFULNESS
    old_inbox = starter_team.ROLES['Inbox'][1] + starter_team.SPECIALIST_SUFFIX + ' ' + starter_team.PREVIOUS_RESOURCEFULNESS
    async with sessions() as db:
        chief = await agent_store.create_agent(db, owner_id=owner, name='Chief', instructions=old_chief)
        inbox = await agent_store.create_agent(db, owner_id=owner, name='Inbox', instructions=old_inbox)
        edited = await agent_store.create_agent(db, owner_id=owner, name='Edited', instructions=old_inbox + ' My own rule.')
        db.add(AppSetting(key=onboarding.setting_key(owner), version=1, updated_by=owner, value_json={'auto_created': True, 'agent_id': chief.id}))
        db.add(AppSetting(key=prefs.key(owner, 'starter'), version=1, updated_by=owner, value_json={'created': ['Inbox']}))
        await db.commit()
    await starter_team.upgrade(rt)
    async with sessions() as db:
        rows = {a.id: a.instructions for a in await db.scalars(select(Agent).where(Agent.owner_id == owner))}
    assert rows[chief.id] == starter_team.CHIEF_INSTRUCTIONS
    assert rows[inbox.id].endswith(starter_team.RESOURCEFULNESS)
    assert rows[edited.id] == old_inbox + ' My own rule.'
