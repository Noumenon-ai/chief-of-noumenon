"""Actual CLI adapters and subprocess MCP shims, with fake engine programs.

The sandbox launcher is replaced only for these known fake programs. Actual
bubblewrap isolation is independently exercised by tests/core/test_turn_*.
"""
import json

import pytest
from sqlalchemy import delete

from app.core import turn_sandbox
from app.core.config import settings
from app.db.models import UserCredential
from app.services import agent_store, connector_service, user_credential_service
from tests.services.test_local_connector import connector, ADMIN, CREDENTIAL_A, arguments  # noqa: F401
from tests.services.test_composio_chat import cli, rt, tool_step  # noqa: F401
from tests.services.test_composio_generic_codex import codex, crt, call  # noqa: F401
from tests.services.thread_harness import cleanup, owner, sessions, pending_approval, finished, events_of  # noqa: F401


@pytest.fixture
async def local_transport(monkeypatch, sessions, owner, tmp_path):
    monkeypatch.setattr(settings, 'TURN_SANDBOX_ENABLED', True)
    monkeypatch.setattr(settings, 'TURN_SANDBOX_NETWORK_ENABLED', True)
    from app.core import codex_sandbox
    codex_sandbox._CACHE.clear()
    monkeypatch.setenv('CODEX_HOME', str(tmp_path / 'synthetic-codex-home'))
    monkeypatch.setattr(turn_sandbox, 'prepare', lambda args, **kwargs: (args, True))
    yield
    async with sessions() as db:
        await db.execute(delete(UserCredential).where(UserCredential.user_id == owner)); await db.commit()


async def bot(sessions, owner, connector, provider):
    async with sessions() as db:
        agent = await agent_store.create_agent(db, owner_id=owner, name='Fake connector bot', provider=provider)
        await connector_service.save(db, owner, ADMIN)
        await user_credential_service.save_token(db, user_id=owner,
            provider=f'{connector_service.PROVIDER}:grants:{agent.id}', file_path='-', plaintext=json.dumps({connector['a']: 'act'}))
        return agent


@pytest.mark.parametrize('engine', ['claude', 'codex'])
@pytest.mark.parametrize('action,decision', [('list_items', None), ('create_item', 'allow'), ('send_message', 'deny'), ('charge', None)])
async def test_cli_bridge_read_approve_deny_payments(engine, action, decision, sessions, owner, connector, cli, rt, codex, crt, local_transport):
    runtime = rt if engine == 'claude' else crt
    agent = await bot(sessions, owner, connector, engine)
    args = arguments(connector, action)
    if engine == 'claude':
        cli.script(tool_step('apps_run', args))
    else:
        codex.plan(call('apps_run', args))
    thread = await runtime.create_thread(provider=engine, agent_id=agent.id)
    await runtime.send_turn(thread.id, 'Use the granted test app')
    if decision:
        approval = await pending_approval(sessions, thread.id)
        assert approval.input == args and 'testapp / work /' in approval.summary
        assert connector['calls'] == []
        assert await runtime.answer_approval(approval.id, decision)
    await finished(sessions, thread.id)
    events = await events_of(sessions, thread.id)
    assert not any(event.type == 'turn.failed' for event in events), [(e.type, e.data) for e in events]
    assert len(connector['calls']) == (1 if action == 'list_items' or decision == 'allow' else 0)
    logs = cli.log() if engine == 'claude' else codex.log()
    assert ADMIN not in json.dumps(logs) and CREDENTIAL_A not in json.dumps(logs)
