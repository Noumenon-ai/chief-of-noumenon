"""Native Codex permission profile protocol; no real login or model turns."""
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import tomllib

import pytest

from app.core import codex_sandbox, turn_sandbox
from app.core.config import settings
from app.services import codex_adapter
from app.services.codex_adapter import CodexAdapter
from tests.services.test_codex_adapter import codex, crt, codex_thread, data_of  # noqa: F401
from tests.services.test_workspace_bridge import context
from tests.services.thread_harness import (  # noqa: F401
    sessions, owner, cleanup, events_of, finished, pending_approval,
)


@pytest.fixture
def protected(monkeypatch, codex):
    monkeypatch.setattr(settings, 'TURN_SANDBOX_ENABLED', True)
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    monkeypatch.setenv('CODEX_HOME', str(codex.folder / 'login'))
    codex_sandbox._CACHE.clear()
    monkeypatch.setattr(turn_sandbox, 'prepare', Mock(side_effect=AssertionError('Codex must not enter our box')))


async def run(codex, mode='ask', resume=False, provider_state=None):
    ctx = context(codex.workspace)
    ctx.approval_mode = mode
    ctx.resume = resume
    ctx.provider_state = provider_state
    sink = SimpleNamespace(lost=False, emit=AsyncMock(return_value=True), delta=Mock())
    gate = SimpleNamespace(open=AsyncMock(return_value=SimpleNamespace()),
                           decide=AsyncMock(return_value=SimpleNamespace(kind='allow')))
    result = await CodexAdapter().run_turn(ctx, sink, gate)
    return result, sink, gate


def argv_of(codex, command):
    return [e['argv'] for e in codex.log() if e.get('event') == 'argv' and e['argv'][0] == command]


def config(argv):
    argv = argv[:argv.index('--')] if '--' in argv else argv
    return tomllib.loads('\n'.join(argv[i+1] for i, arg in enumerate(argv) if arg == '-c'))


@pytest.mark.parametrize('mode', ['ask', 'accept_edits', 'approve_for_me', 'plan'])
@pytest.mark.parametrize('tools', [False, True])
@pytest.mark.parametrize('resume', [False, True])
async def test_profile_every_mode_and_resume(protected, codex, monkeypatch, mode, tools, resume):
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', tools)
    state = None
    if resume:
        first, _, _ = await run(codex, mode)
        assert first.status == 'succeeded'
        state = first.provider_state
    result, _, gate = await run(codex, mode, resume, state)
    assert result.status == 'succeeded', result.error
    argv = argv_of(codex, 'app-server')[-1]
    conf = config(argv)
    assert conf['default_permissions'] == 'con'
    fs = conf['permissions']['con']['filesystem']
    assert fs[':root'] == 'deny' and fs[':minimal'] == 'read'
    assert fs[':workspace_roots'] == {'.': 'read' if mode == 'plan' or not tools else 'write'}
    assert str(Path.home()) not in fs and str(codex.folder / 'login') not in fs
    assert str(settings.SQLITE_FILE.parent.resolve()) not in fs
    assert conf['mcp_servers'] == {} and conf['web_search'] == 'disabled'
    assert all(conf['features'][f] is False for f in ('apps', 'plugins', 'hooks', 'remote_plugin'))
    assert 'features.unified_exec=false' not in argv
    assert config(argv_of(codex, 'sandbox')[-1]) == conf
    for method in ('thread/resume' if resume else 'thread/start', 'turn/start'):
        params = codex.received(method)[-1]['params']
        assert params['approvalPolicy'] == 'untrusted'
        assert params['approvalsReviewer'] == 'user'
        assert params['permissions'] == 'con'
        assert params['runtimeWorkspaceRoots'] == [str(codex.workspace)]
        assert not {'sandbox', 'sandboxPolicy', 'environments'} & params.keys()
    assert len(argv_of(codex, 'sandbox')) == 1  # cached per version/workspace/profile
    assert not list((codex.folder / 'login').glob('.con-canary-*'))
    assert not list(codex.workspace.glob('.con-probe-*'))
    gate.open.assert_not_awaited()


@pytest.mark.parametrize('mode', ['ask', 'accept_edits', 'approve_for_me', 'plan'])
@pytest.mark.parametrize('method', codex_adapter.FILE_REQUESTS)
@pytest.mark.parametrize('outside', ['absolute', 'traversal', 'symlink', 'rename', 'grant', 'unknown'])
async def test_outside_patch_denied_without_card(protected, codex, mode, method, outside):
    path = str(codex.folder / 'outside')
    (codex.workspace / 'link').symlink_to(codex.folder, target_is_directory=True)
    step = {'type': 'native_request', 'method': method, 'report': 'declined'}
    if outside == 'absolute': step['path'] = path
    if outside == 'traversal': step['path'] = '../outside'
    if outside == 'symlink': step['path'] = 'link/outside'
    if outside == 'rename': step['changes'] = {'notes.txt': {'type': 'update', 'move_path': path}}
    if outside == 'grant': step['grant_root'] = str(codex.workspace)
    if outside == 'unknown': step['changes'] = {}
    codex.plan(step)
    result, _, gate = await run(codex, mode)
    assert result.status == 'succeeded', result.error
    assert codex.answers()[0]['result'] == {'decision': 'denied' if method == 'applyPatchApproval' else 'decline'}
    gate.open.assert_not_awaited()


@pytest.mark.parametrize('mode,card,decision', [('ask', True, 'accept'), ('accept_edits', False, 'accept'), ('plan', False, 'decline')])
async def test_inside_patch_normal_approval(protected, codex, mode, card, decision):
    codex.plan({'type': 'file'})
    result, _, gate = await run(codex, mode)
    assert result.status == 'succeeded', result.error
    assert gate.open.await_count == int(card)
    assert codex.answers()[0]['result'] == {'decision': decision}


async def test_native_command_gets_normal_card(protected, codex):
    codex.plan({'type': 'command'})
    result, _, gate = await run(codex)
    assert result.status == 'succeeded', result.error
    gate.open.assert_awaited_once()
    assert codex.answers()[0]['result'] == {'decision': 'accept'}


async def test_safe_command_without_approval_is_not_violation(protected, codex):
    codex.plan({'type': 'unrequested_native', 'event': 'item/completed'})
    result, _, gate = await run(codex)
    assert result.status == 'succeeded'
    gate.open.assert_not_awaited()


async def test_unapproved_patch_completion_stops_engine(protected, codex):
    codex.plan({'type': 'unrequested_native', 'event': 'item/completed', 'item_type': 'fileChange'})
    result, _, gate = await run(codex)
    assert result.error_code == 'codex_confinement_failed'
    assert not codex.received('turn/interrupt')
    gate.open.assert_not_awaited()


async def test_successful_patch_after_denial_is_violation(protected, codex):
    codex.plan({'type': 'native_request', 'path': '/outside', 'report': 'completed'})
    result, _, gate = await run(codex)
    assert result.error_code == 'codex_confinement_failed'
    gate.open.assert_not_awaited()


async def test_preflight_failure_no_fallback_and_cleanup(protected, codex):
    codex.plan(preflight_fail=True)
    result, _, _ = await run(codex)
    assert result.error_code == 'codex_confinement_unavailable'
    assert 'No unprotected run' in result.error
    assert not argv_of(codex, 'app-server')
    canary = next(e for e in codex.log() if e.get('event') == 'canary')
    assert canary['exists']
    assert all(not Path(canary[k]).exists() for k in ('path', 'readable', 'output'))


async def test_probe_no_longer_has_blanket_or_feature_refusal(protected, codex):
    assert (await CodexAdapter().probe(models=False)).ready
    assert not argv_of(codex, 'sandbox')


@pytest.mark.parametrize('extra', [{'additionalPermissions': {'fileSystem': {'read': ['/']}}},
                                  {'networkApprovalContext': {'host': 'example.com'}},
                                  {'sandboxPermissions': 'require_escalated'}])
async def test_escalation_never_gets_card(protected, codex, extra):
    codex.plan({'type': 'native_request', 'method': codex_adapter.COMMAND_REQUESTS[0], 'extra': extra})
    result, _, gate = await run(codex)
    assert result.status == 'succeeded'
    assert codex.answers()[0]['result'] == {'decision': 'decline'}
    gate.open.assert_not_awaited()


@pytest.mark.parametrize('mode', ['ask', 'accept_edits', 'approve_for_me', 'plan'])
async def test_permission_root_grant_is_empty(protected, codex, mode):
    codex.plan({'type': 'native_request', 'method': 'item/permissions/requestApproval', 'grant_root': '/'})
    result, _, gate = await run(codex, mode)
    assert result.status == 'succeeded'
    assert codex.answers()[0]['result'] == {'permissions': {}, 'scope': 'turn'}
    gate.open.assert_not_awaited()


async def test_inherited_mcp_excluded_and_unknown_elicitation_denied(protected, codex):
    codex.plan({'type': 'mcp'}, user_mcp={'docs': {'command': '/bin/sh'}})
    result, _, gate = await run(codex)
    assert result.status == 'succeeded'
    assert config(argv_of(codex, 'app-server')[0])['mcp_servers'] == {}
    assert codex.received('thread/start')[0]['params']['config']['mcp_servers']['docs'] == {'enabled': False}
    assert codex.answers()[0]['result'] == {'action': 'decline'}
    gate.open.assert_not_awaited()


@pytest.mark.parametrize('failure', ['reject_override', 'reject_thread_override', 'policy_mismatch', 'profile_mismatch'])
async def test_rejected_policy_never_sends_prompt(protected, codex, failure):
    codex.plan(**{failure: 'permissions' if 'override' in failure else True})
    result, _, _ = await run(codex)
    assert result.status == 'failed'
    assert not codex.received('turn/start')
    assert len(argv_of(codex, 'app-server')) == 1


async def test_setting_change_during_preflight_does_not_remove_profile(protected, codex, monkeypatch):
    original = codex_sandbox.preflight
    async def checked(*args, **kwargs):
        overrides = await original(*args, **kwargs)
        monkeypatch.setattr(settings, 'TURN_SANDBOX_ENABLED', False)
        return overrides
    monkeypatch.setattr(codex_sandbox, 'preflight', checked)
    result, _, _ = await run(codex)
    assert result.status == 'succeeded'
    assert config(argv_of(codex, 'app-server')[0])['default_permissions'] == 'con'


@pytest.mark.parametrize('kind', ['command', 'file'])
@pytest.mark.parametrize('decision', ['allow', 'deny'])
async def test_protected_native_tools_use_durable_cards(crt, sessions, owner, codex, protected,
                                                       monkeypatch, kind, decision):
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    codex.plan({'type': kind})
    thread = await codex_thread(crt, sessions, owner, mode='ask')
    await crt.send_turn(thread.id, 'Use the native workspace tool')
    approval = await pending_approval(sessions, thread.id)
    assert approval.tool == ('Bash' if kind == 'command' else 'apply_patch')
    assert await crt.answer_approval(approval.id, decision)
    await finished(sessions, thread.id)
    assert not data_of(await events_of(sessions, thread.id), 'turn.failed')
    assert codex.answers()[0]['result'] == {'decision': 'accept' if decision == 'allow' else 'decline'}


@pytest.mark.parametrize('method', codex_adapter.FILE_REQUESTS)
async def test_inside_legacy_and_modern_patch_get_card(protected, codex, method):
    codex.plan({'type': 'native_request', 'method': method})
    result, _, gate = await run(codex)
    assert result.status == 'succeeded'
    gate.open.assert_awaited_once()
    assert codex.answers()[0]['result'] == {'decision': 'approved' if method == 'applyPatchApproval' else 'accept'}


async def test_modern_rename_outside_denied(protected, codex):
    codex.plan({'type': 'native_request', 'changes': [
        {'path': 'notes.txt', 'kind': {'type': 'update', 'movePath': '/outside'}}]})
    result, _, gate = await run(codex)
    assert result.status == 'succeeded'
    assert codex.answers()[0]['result'] == {'decision': 'decline'}
    gate.open.assert_not_awaited()


async def test_cache_separates_version_workspace_mode_and_network(protected, codex, monkeypatch):
    assert (await run(codex))[0].status == 'succeeded'
    assert (await run(codex, 'plan'))[0].status == 'succeeded'
    codex.plan(version='codex-cli 0.166.0')
    assert (await run(codex))[0].status == 'succeeded'
    nested = codex.workspace / 'nested'
    nested.mkdir()
    codex.workspace = nested
    assert (await run(codex))[0].status == 'succeeded'
    monkeypatch.setattr(settings, 'TURN_SANDBOX_NETWORK_ENABLED', True)
    assert (await run(codex))[0].status == 'succeeded'
    assert len(argv_of(codex, 'sandbox')) == 5
    assert config(argv_of(codex, 'sandbox')[-1])['permissions']['con']['network'] == {'enabled': False}
