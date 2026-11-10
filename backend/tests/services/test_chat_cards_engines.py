"""Real adapters against synthetic child processes/HTTP fixtures, never live models."""
import pytest
from app.core.config import settings
from app.services import agent_store, chat_cards, connector_service
from tests.services.test_composio_chat import cli, rt  # noqa: F401
from tests.services.test_composio_generic_codex import codex, crt  # noqa: F401
from tests.services.test_openai_chat_adapter import ort, endpoint, delta  # noqa: F401
from tests.services.test_acp_adapter import acp, art  # noqa: F401
from tests.services.test_api_agent_tools import script, tool
from tests.services.thread_harness import sessions, owner, cleanup, finished, events_of  # noqa: F401


@pytest.mark.parametrize('engine', ['claude', 'codex', 'api'])
async def test_question_tool_and_person_answer_on_each_engine(engine, sessions, owner, cli, rt, codex, crt, ort, endpoint, monkeypatch):
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    runtime = {'claude': rt, 'codex': crt, 'api': ort}[engine]
    provider = 'openai_compat' if engine == 'api' else engine
    async with sessions() as db:
        agent = await agent_store.create_agent(db, owner_id=owner, name='Question bot', provider=provider, memory_enabled=False)
    thread = await runtime.create_thread(provider=provider, agent_id=agent.id)
    arguments = {'question': 'When?', 'options': ['Today', 'Tomorrow']}
    if engine == 'claude': cli.script({'type': 'tool', 'tool_name': 'mcp__team__ask_question', 'tool_input': arguments})
    elif engine == 'codex': codex.plan({'type': 'team', 'server': 'team', 'tool': 'ask_question', 'arguments': arguments})
    else: script(endpoint, tool('mcp__team__ask_question', arguments), delta('Choose a time.', 'stop'))
    await runtime.send_turn(thread.id, 'Help choose a time')
    await finished(sessions, thread.id)
    events = await events_of(sessions, thread.id)
    assert not [e for e in events if e.type == 'turn.failed'], [(e.type, e.data) for e in events]
    cards = [e.data for e in events if e.type == 'chat.card']
    assert len(cards) == 1 and cards[0]['options'] == arguments['options']
    async with sessions() as db:
        assert await connector_service.grants(db, owner, agent.id) == {}
    if engine == 'claude': cli.script({'type': 'chat', 'text': 'Tomorrow selected.'})
    elif engine == 'codex': codex.plan({'type': 'chat', 'text': 'Tomorrow selected.'})
    else: script(endpoint, delta('Tomorrow selected.', 'stop'))
    await chat_cards.respond(runtime, thread.id, cards[0]['id'], 1, admin=True)
    await finished(sessions, thread.id, 2)
    events = await events_of(sessions, thread.id)
    assert [e.data['prompt_text'] for e in events if e.type == 'turn.started'][-1] == 'Tomorrow'
    assert len([e for e in events if e.type == 'chat.card.answered']) == 1
    with pytest.raises(ValueError): await chat_cards.respond(runtime, thread.id, cards[0]['id'], 1, admin=True)


@pytest.mark.parametrize('engine', ['claude', 'codex', 'api'])
async def test_invalid_card_credentials_never_enter_thread_events_or_logs(engine, sessions, owner, cli, rt, codex, crt, ort, endpoint, monkeypatch, caplog):
    import json
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    runtime = {'claude': rt, 'codex': crt, 'api': ort}[engine]
    provider = 'openai_compat' if engine == 'api' else engine
    async with sessions() as db:
        agent = await agent_store.create_agent(db, owner_id=owner, name='Card validation', provider=provider, memory_enabled=False)
    thread = await runtime.create_thread(provider=provider, agent_id=agent.id)
    secret = 'GOCSPX-' + 'synthetic_private_value_12345'
    arguments = {'question': secret, 'options': ['a', 'b'], 'clientSecret': 'private-client-value'}
    if engine == 'claude': cli.script({'type': 'tool', 'tool_name': 'mcp__team__ask_question', 'tool_input': arguments})
    elif engine == 'codex': codex.plan({'type': 'team', 'server': 'team', 'tool': 'ask_question', 'arguments': arguments})
    else: script(endpoint, tool('mcp__team__ask_question', arguments), delta('Unable to show that card.', 'stop'))
    await runtime.send_turn(thread.id, 'Test malformed suggestion')
    await finished(sessions, thread.id)
    events = await events_of(sessions, thread.id)
    assert not [e for e in events if e.type == 'chat.card']
    stored = json.dumps([e.data for e in events])
    for value in [secret, 'private-client-value']:
        assert value not in stored and value not in caplog.text


@pytest.mark.parametrize('mode', ['ask', 'plan'])
@pytest.mark.parametrize('valid', [True, False])
async def test_acp_question_permission_uses_the_card_gate(art, acp, sessions, owner, monkeypatch, mode, valid):
    from sqlalchemy import select
    from app.db.models import Approval
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    async with sessions() as db:
        agent = await agent_store.create_agent(db, owner_id=owner, name='ACP questions', provider='acp', memory_enabled=False)
    arguments = {'question': 'When?', 'options': ['Today', 'Tomorrow']} if valid else {'question': 'Invalid', 'options': ['Only one']}
    acp.plan({'type': 'permission', 'kind': 'other', 'title': 'mcp__team__ask_question', 'raw': arguments})
    thread = await art.create_thread(provider='acp', agent_id=agent.id)
    await art.send_turn(thread.id, 'Choose a time', approval_mode=mode)
    await finished(sessions, thread.id)
    launch = next(server for server in acp.received('session/new')[0]['params']['mcpServers'] if server['name'] == 'team')
    assert '--cards-only' in launch['args']
    assert acp.answers()[0]['result']['outcome']['optionId'] == ('once' if valid else 'no')
    async with sessions() as db:
        approvals = list(await db.scalars(select(Approval).where(Approval.thread_id == thread.id)))
        assert len(approvals) == 1 and approvals[0].status == ('allowed' if valid else 'denied')
        assert approvals[0].tool == 'mcp__team__ask_question'


@pytest.fixture
def card_engine(request, engine):
    fake = request.getfixturevalue({'claude': 'cli', 'codex': 'codex', 'acp': 'acp', 'api': 'endpoint'}[engine])
    runtime = request.getfixturevalue({'claude': 'rt', 'codex': 'crt', 'acp': 'art', 'api': 'ort'}[engine])
    return runtime, fake


@pytest.mark.parametrize('engine', ['claude', 'codex', 'acp', 'api'])
@pytest.mark.parametrize('role', ['lead', 'specialist'])
async def test_question_catalog_and_system_rule_for_every_engine_and_role(engine, role, sessions, owner, card_engine, monkeypatch):
    import json
    from app.team import service
    from app.services.api_tools import McpClient
    from app.services.chat_card_schema import QUESTION_RULE
    from app.services.starter_team import RESOURCEFULNESS
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    runtime, fake = card_engine
    provider = 'openai_compat' if engine == 'api' else engine
    async with sessions() as db:
        lead = await agent_store.create_agent(db, owner_id=owner, name='Chief', provider=provider, memory_enabled=False)
        team = await service.set_lead(db, owner, lead.id)
        agent = lead if role == 'lead' else await agent_store.create_agent(db, owner_id=owner, name='Specialist', provider=provider, memory_enabled=False)
        if role == 'specialist':
            agent.team_id = team.id
            await db.commit()
    # Inspect the real mailbox tools/list while the turn owns its live bridges.
    adapter = runtime.adapters[provider]
    original = adapter.run_turn
    catalogs = []
    async def inspect(ctx, sink, gate):
        assert QUESTION_RULE in ctx.instructions and QUESTION_RULE in RESOURCEFULNESS
        launch = ctx.workspace_launch if engine == 'claude' else ctx.team_launch
        client = McpClient(launch)
        try:
            await client.start()
            catalogs.extend((await client.request('tools/list', {}))['tools'])
        finally:
            await client.close()
        return await original(ctx, sink, gate)
    monkeypatch.setattr(adapter, 'run_turn', inspect)
    if engine == 'claude':
        fake.script({'type': 'tool', 'tool_name': 'mcp__bot_files__ask_question', 'tool_input': {'question': 'Continue?', 'options': ['Yes', 'No']}})
    thread = await runtime.create_thread(provider=provider, agent_id=agent.id)
    await runtime.send_turn(thread.id, 'Choose an option')
    await finished(sessions, thread.id)
    events = await events_of(sessions, thread.id)
    assert not [e for e in events if e.type == 'turn.failed'], [(e.type, e.data) for e in events]
    question = next(t for t in catalogs if t['name'] == 'ask_question')
    assert QUESTION_RULE in question['description']
    if engine == 'claude':
        launch = fake.launches[0]
        servers = json.loads(launch['args'][launch['args'].index('--mcp-config') + 1])['mcpServers']
        assert '--chat-cards' in servers['bot_files']['args']
        assert QUESTION_RULE in launch['system_prompt']
        assert any(e.type == 'chat.card' for e in events)
    elif engine == 'codex':
        params = fake.received('thread/start')[0]['params']
        assert 'team' in params['config']['mcp_servers']
        assert QUESTION_RULE in params['developerInstructions']
    elif engine == 'acp':
        assert any(s['name'] == 'team' for s in fake.received('session/new')[0]['params']['mcpServers'])
        assert QUESTION_RULE in fake.prompts()[0]
    else:
        assert any(t['function']['name'] == 'mcp__team__ask_question' for t in fake.body()['tools'])
        assert QUESTION_RULE in json.dumps(fake.body()['messages'])


@pytest.mark.parametrize('engine', ['claude', 'codex', 'api'])
async def test_prepare_call_tool_emits_normalized_event_and_receives_outcome(engine, sessions, owner, cli, rt, codex, crt, ort, endpoint, monkeypatch):
    from tests.services.test_chat_cards import CALL
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    runtime = {'claude': rt, 'codex': crt, 'api': ort}[engine]
    provider = 'openai_compat' if engine == 'api' else engine
    async with sessions() as db:
        agent = await agent_store.create_agent(db, owner_id=owner, name='Call helper', provider=provider, memory_enabled=False)
    thread = await runtime.create_thread(provider=provider, agent_id=agent.id)
    if engine == 'claude': cli.script({'type': 'tool', 'tool_name': 'mcp__team__prepare_call', 'tool_input': CALL})
    elif engine == 'codex': codex.plan({'type': 'team', 'server': 'team', 'tool': 'prepare_call', 'arguments': CALL})
    else: script(endpoint, tool('mcp__team__prepare_call', CALL), delta('Your call is ready.', 'stop'))
    await runtime.send_turn(thread.id, 'Help me call the restaurant')
    await finished(sessions, thread.id)
    events = await events_of(sessions, thread.id)
    assert not [e for e in events if e.type == 'turn.failed'], [(e.type, e.data) for e in events]
    cards = [e.data for e in events if e.type == 'chat.card']
    assert len(cards) == 1
    assert cards[0] == {'id': cards[0]['id'], 'kind': 'call', **CALL, 'phone_number': '+13055550100'}
    assert not [e for e in events if e.type == 'chat.card.answered']
    if engine == 'claude': cli.script({'type': 'chat', 'text': 'Outcome recorded.'})
    elif engine == 'codex': codex.plan({'type': 'chat', 'text': 'Outcome recorded.'})
    else: script(endpoint, delta('Outcome recorded.', 'stop'))
    await chat_cards.respond(runtime, thread.id, cards[0]['id'], 1, admin=True)
    await finished(sessions, thread.id, 2)
    events = await events_of(sessions, thread.id)
    assert [e.data['prompt_text'] for e in events if e.type == 'turn.started'][-1] == "Didn't reach them"
    assert len([e for e in events if e.type == 'chat.card.answered']) == 1
