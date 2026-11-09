"""Workspace mailbox calls never inherit CLI credentials or bypass decisions."""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.core import turn_sandbox
from app.core.config import settings
from app.services.api_tools import Tools
from app.services.local_claude_runner import build_args
from app.services.workspace_bridge import WorkspaceBridge
from app.services.provider_adapter import TurnContext


@pytest.mark.parametrize('mode', ['ask', 'accept_edits', 'plan'])
@pytest.mark.parametrize('resume', [False, True])
@pytest.mark.parametrize('tools', [False, True])
def test_claude_native_tools_disabled_every_mode(mode, resume, tools):
    args = build_args(Path('/fake/claude'), 'session', tools=tools, resume=resume, approval_mode=mode)
    assert args[args.index('--tools') + 1] == ''
    assert '--strict-mcp-config' in args and '--restricted' in args
    assert json.loads(args[args.index('--settings') + 1])['disableAllHooks'] is True
    assert '--disable-slash-commands' in args
    assert ('--resume' in args) == resume


def context(workspace):
    return TurnContext(thread_id=1, turn_id=1, prompt='test', workspace=workspace, model=None,
        provider_session_id='test', provider_state=None, resume=False, history=AsyncMock(), agent_id=1)


@pytest.mark.parametrize('decision', ['allow', 'deny'])
@pytest.mark.parametrize('name,args', [('write', {'path':'file', 'content':'ok'}), ('shell', {'command':'echo ok'})])
async def test_mailbox_gates_every_request(tmp_path, monkeypatch, decision, name, args):
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    ctx = context(tmp_path)
    sink = SimpleNamespace(lost=False, emit=AsyncMock(return_value=True))
    gate = SimpleNamespace(open=AsyncMock(return_value=object()), decide=AsyncMock(return_value=SimpleNamespace(kind=decision, message='denied')))
    run = SimpleNamespace(ctx=ctx, recorder=sink, gate=gate, turn_id=1)
    bridge = WorkspaceBridge(None, run)
    bridge.tools.local = AsyncMock(return_value={'output':'ok'})
    try:
        for _ in range(2):
            await bridge.execute(name, args)
        assert gate.open.await_count == gate.decide.await_count == 2
        ids = [c.kwargs['request_id'] for c in gate.open.call_args_list]
        assert len(set(ids)) == 2
        assert bridge.tools.local.await_count == (2 if decision == 'allow' else 0)
        assert all(c.kwargs['tool'] == 'api__'+name for c in gate.open.call_args_list)
    finally:
        await bridge.close()


@pytest.mark.parametrize('name,args', [('write', {'path':'file','content':'ok'}), ('read', {'path':'file'}), ('shell', {'command':'true'})])
async def test_bridge_never_falls_back_without_box(tmp_path, monkeypatch, name, args):
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    monkeypatch.setattr(turn_sandbox, 'self_check', lambda: {'status':'off'})
    tools = Tools(context(tmp_path), None, None)
    tools.require_sandbox = True
    result = await tools.local(name, args)
    assert 'require the Linux turn sandbox' in result['error']
    assert not (tmp_path/'file').exists()


async def test_tool_process_environment_is_credential_free(tmp_path, monkeypatch):
    from app.services import api_tools
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'synthetic-secret')
    monkeypatch.setenv('OPENAI_API_KEY', 'synthetic-secret')
    monkeypatch.setenv('CODEX_HOME', str(tmp_path/'login'))
    monkeypatch.setattr(turn_sandbox, 'self_check', lambda: {'status':'available'})
    captured = {}
    def wrap(args, **kwargs):
        captured.update(kwargs)
        return args
    monkeypatch.setattr(turn_sandbox, 'command', wrap)
    tools = Tools(context(tmp_path), None, None)
    result = await tools.local('write', {'path':'file', 'content':'works'})
    assert not result.get('error')
    assert (tmp_path/'file').read_text() == 'works'
    assert captured['tool_worker'] is True
    assert captured['env']['HOME'] == '/tmp/chief-workspace-home'
    assert not any('KEY' in key or key == 'CODEX_HOME' for key in captured['env'])


from tests.services.thread_harness import (  # noqa: E402,F401
    sessions, owner, cleanup, rt, wait_until, finished, events_of,
)


@pytest.mark.parametrize('answer', ['allow', 'deny'])
@pytest.mark.parametrize('tool', ['write', 'read'])
async def test_workspace_mailbox_real_durable_gate(rt, sessions, owner, tmp_path, monkeypatch, answer, tool):
    from sqlalchemy import select
    from app.db.models import Approval
    from app.services import agent_store
    from app.services.api_tools import McpClient
    from app.services.provider_adapter import TurnOutcome
    from app.services.workspace_tool_worker import execute
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    (tmp_path / 'input.txt').write_text('read through the bridge')
    # This test isolates the real mailbox and durable gate. The separate real
    # bubblewrap test proves the OS boundary, without replacing namespace errors.
    async def local(self, name, args):
        return execute(self.ctx.workspace, name, args)
    monkeypatch.setattr(Tools, 'local', local)
    async def turn(ctx, sink, gate):
        assert ctx.workspace_launch is not None
        client = McpClient(ctx.workspace_launch)
        try:
            await client.start()
            result = await client.request('tools/call', {'name':tool, 'arguments':{'path':'approved.txt','content':'saved'} if tool == 'write' else {'path':'input.txt'}})
            return TurnOutcome('succeeded', result=json.dumps(result))
        finally:
            await client.close()
    monkeypatch.setattr(rt.adapters['claude'], 'run_turn', turn)
    async with sessions() as db:
        agent = await agent_store.create_agent(db, owner_id=owner, name='Mailbox proof', provider='claude',
            workspace_path=str(tmp_path), memory_enabled=False, recall_enabled=False)
    thread = await rt.create_thread(provider='claude', agent_id=agent.id)
    await rt.send_turn(thread.id, 'write a file')
    async def pending():
        async with sessions() as db:
            return await db.scalar(select(Approval).where(Approval.thread_id == thread.id, Approval.status == 'pending'))
    if tool == 'write':
        approval = await wait_until(pending)
        assert approval.tool == 'api__write'
        assert not (tmp_path/'approved.txt').exists()
        assert await rt.answer_approval(approval.id, answer)
    await finished(sessions, thread.id)
    assert (tmp_path/'approved.txt').exists() == (answer == 'allow' and tool == 'write')
    events = await events_of(sessions, thread.id)
    assert any(e.type == 'approval.resolved' for e in events)
    assert any(e.type == 'approval.requested' for e in events) == (tool == 'write')
    if tool == 'read':
        async with sessions() as db:
            row = await db.scalar(select(Approval).where(Approval.thread_id == thread.id))
            assert row.status == 'allowed'
    assert sum(e.type == 'tool.started' for e in events) == (1 if tool == 'read' or answer == 'allow' else 0)
    if tool == 'read':
        resolved = [e for e in events if e.type == 'approval.resolved']
        assert resolved[0].data['by'] == 'workspace_read'
        assert await pending() is None



@pytest.mark.parametrize('mode', ['ask', 'accept_edits', 'plan'])
@pytest.mark.parametrize('tools', [False, True])
def test_claude_chat_and_tool_turns_both_request_engine_box(tmp_path, monkeypatch, mode, tools):
    from app.services import local_claude_runner as runner
    monkeypatch.setattr(runner, 'resolve_claude_executable', lambda: Path('/fake/claude'))
    captured = {}
    def run(args, **kwargs):
        captured.update(kwargs)
        return runner.RunOutput('', '', 0)
    monkeypatch.setattr(runner, 'run_blocking', run)
    runner._run_blocking('hello', 'session', None, None, tools=tools, workspace=tmp_path, approval_mode=mode)
    assert captured['sandbox'] is True
    assert captured['sandbox_engine'] == 'claude'

@pytest.mark.parametrize('server_kind', ['workspace', 'apps', 'team'])
@pytest.mark.parametrize('result', [{'content': [{'type': 'text', 'text': 'written'}]}, {'error': 'The person denied this action.'}])
def test_mailbox_waits_past_old_timeout_for_one_decision(tmp_path, monkeypatch, server_kind, result):
    """Simulate fifteen minutes at the card, without sleeping or real engine calls."""
    import time
    from app.services.workspace_mailbox import Server as WorkspaceServer
    from app.composio_mcp_server import Server as AppServer
    from app.team.mcp_server import Server as TeamServer
    server = {'workspace': lambda: WorkspaceServer(tmp_path),
              'apps': lambda: AppServer(tmp_path, {}),
              'team': lambda: TeamServer(tmp_path)}[server_kind]()
    name = 'write' if server_kind == 'workspace' else 'list_agents' if server_kind == 'team' else 'fixture_action'
    if server_kind == 'apps':
        server.names = {name}
    elapsed = 0
    requests = []
    def advance(_):
        nonlocal elapsed
        elapsed += 60
        pending = list(tmp_path.glob('req-*.json'))
        assert len(pending) == 1
        requests.append(pending[0].name)
        if elapsed >= 900:
            response = tmp_path / pending[0].name.replace('req-', 'resp-')
            response.write_text(json.dumps(result))
    monkeypatch.setattr(time, 'monotonic', lambda: elapsed)
    monkeypatch.setattr(time, 'sleep', advance)
    assert server.call(name, {}) == result
    assert elapsed == 900
    assert len(set(requests)) == 1


def test_claude_mcp_timeout_outlives_approval_budget(monkeypatch):
    from app.services.local_claude_runner import child_env
    monkeypatch.setenv('MCP_TOOL_TIMEOUT', '1')
    monkeypatch.setenv('CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT', '1')
    env = child_env()
    for name in ['MCP_TOOL_TIMEOUT', 'CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT', 'CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS']:
        # A routine may wait a whole day; transport must also leave time to run.
        assert int(env[name]) > 1440 * 60 * 1000


@pytest.mark.parametrize('name,args', [('read', {'path': 'waittest.txt'}), ('glob', {'pattern': '**/*'}), ('grep', {'pattern': '*', 'text': 'saved'})])
def test_confined_reads_are_free_in_ask_mode(tmp_path, name, args):
    from app.services.tool_policy import automatic
    from app.services.workspace_tool_worker import execute
    (tmp_path / 'waittest.txt').write_text('saved')
    run = SimpleNamespace(ctx=SimpleNamespace(draft_only=False, workspace_launch=object()))
    assert automatic('api__' + name, 'ask', run, args) == ('allowed', 'workspace_read')
    assert execute(tmp_path, name, args)


@pytest.mark.parametrize('path', ['../login', '/etc/passwd', 'sub/../../login', '..\\login'])
def test_read_traversal_is_refused_before_execution(path):
    from app.services.tool_policy import automatic
    run = SimpleNamespace(ctx=SimpleNamespace(draft_only=False, workspace_launch=object()))
    assert automatic('api__read', 'ask', run, {'path': path}) == ('denied', 'outside_workspace')


@pytest.mark.parametrize('kind', ['file', 'directory', 'hardlink'])
def test_free_reads_do_not_follow_login_links(tmp_path, kind):
    from app.services.workspace_tool_worker import execute
    import os
    workspace = tmp_path / 'bot'; workspace.mkdir()
    login = tmp_path / 'login'; login.mkdir()
    (login / 'auth.json').write_text('synthetic login secret')
    if kind == 'file': (workspace / 'escape').symlink_to(login / 'auth.json')
    elif kind == 'directory': (workspace / 'escape').symlink_to(login, target_is_directory=True)
    else: os.link(login / 'auth.json', workspace / 'escape')
    with pytest.raises((OSError, ValueError)):
        execute(workspace, 'read', {'path': 'escape/auth.json' if kind == 'directory' else 'escape'})
    for name, args in [('glob', {'pattern': '**/*'}), ('grep', {'pattern': '**/*', 'text': 'secret'})]:
        try: result = execute(workspace, name, args)
        except ValueError: continue  # hard links also fail closed while listing
        assert 'secret' not in json.dumps(result) and 'escape' not in json.dumps(result)


@pytest.mark.parametrize('name', ['write', 'edit', 'shell'])
def test_acts_still_ask(name):
    from app.services.tool_policy import automatic
    run = SimpleNamespace(ctx=SimpleNamespace(draft_only=False, workspace_launch=object()))
    assert automatic('api__' + name, 'ask', run, {}) is None


async def test_outside_shell_is_denied_without_a_card(rt, sessions, owner, tmp_path, monkeypatch):
    from app.services import agent_store
    from app.services.provider_adapter import TurnOutcome
    from app.services.shell_paths import REASON
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    async def turn(ctx, sink, gate):
        handle = await gate.open(request_id='outside', tool='api__shell',
            input={'command': 'echo "only mention /other/private/file"'}, summary='outside', kind='command')
        decision = await gate.decide(handle)
        assert decision.kind == 'deny' and decision.message == REASON
        return TurnOutcome('succeeded', result=decision.message)
    monkeypatch.setattr(rt.adapters['claude'], 'run_turn', turn)
    async with sessions() as db:
        agent = await agent_store.create_agent(db, owner_id=owner, name='Confined', workspace_path=str(tmp_path))
    thread = await rt.create_thread(provider='claude', agent_id=agent.id)
    await rt.send_turn(thread.id, 'check files')
    await finished(sessions, thread.id)
    events = await events_of(sessions, thread.id)
    assert not [e for e in events if e.type in ('approval.requested', 'tool.started', 'turn.failed')]
    assert any(e.type == 'approval.resolved' and e.data['status'] == 'denied' for e in events)
