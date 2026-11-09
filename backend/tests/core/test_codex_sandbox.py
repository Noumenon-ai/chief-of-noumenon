"""Profile construction and Docker-free native Codex sandbox proof."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib

import pytest

from app.core import codex_sandbox
from app.core.config import settings


@pytest.fixture
def layout(tmp_path, monkeypatch):
    home = tmp_path / 'home'
    work = tmp_path / 'workspace'
    login = home / '.codex'
    login.mkdir(parents=True)
    work.mkdir()
    data = tmp_path / 'data'
    data.mkdir()
    monkeypatch.setattr(settings, 'SQLITE_PATH', str(data / 'app.db'))
    env = {'HOME': str(home), 'CODEX_HOME': str(login), 'PATH': os.defpath}
    return work, env


def filesystem(overrides):
    return tomllib.loads('\n'.join(overrides))['permissions']['con']['filesystem']


@pytest.mark.parametrize('readonly', [True, False])
def test_profile_runtime_and_resolver_paths(layout, readonly):
    work, env = layout
    fs = filesystem(codex_sandbox.permission_overrides(Path('/bin/sh'), work, env, readonly=readonly, network=True))
    assert fs[':root'] == 'deny' and fs[':minimal'] == 'read'
    assert fs[':workspace_roots'] == {'.': 'read' if readonly else 'write'}
    assert fs['/usr'] == 'read'
    assert '/etc/resolv.conf' not in fs or not Path('/etc/resolv.conf').is_symlink()
    assert fs[str(Path('/etc/resolv.conf').resolve())] == 'read'
    assert env['HOME'] not in fs and env['CODEX_HOME'] not in fs
    assert str(settings.SQLITE_FILE.parent) not in fs
    assert '/run' not in fs and fs['/etc'] == 'read'


@pytest.mark.parametrize('target', ['home', 'login', 'data', 'login_child', 'data_child', 'parent'])
def test_no_private_workspace_grants(layout, target):
    work, env = layout
    folder = {'home': Path(env['HOME']), 'login': Path(env['CODEX_HOME']),
              'data': settings.SQLITE_FILE.parent, 'login_child': Path(env['CODEX_HOME']) / 'sub',
              'data_child': settings.SQLITE_FILE.parent / 'sub', 'parent': work.parent}[target]
    folder.mkdir(exist_ok=True)
    with pytest.raises(OSError):
        codex_sandbox.permission_overrides(Path('/bin/sh'), folder, env, readonly=False, network=True)


def test_node_install_prefix_uses_turn_sandbox_discovery(layout, tmp_path):
    work, env = layout
    prefix = tmp_path / 'node'
    package = prefix / 'lib/node_modules/@openai/codex'
    (package / 'bin').mkdir(parents=True)
    (prefix / 'bin').mkdir()
    (package / 'package.json').write_text('{"optionalDependencies":{"@openai/codex-linux-x64":"1"}}')
    native = package.parent / 'codex-linux-x64'
    native.mkdir()
    launcher = package / 'bin/codex.js'
    launcher.write_text('#!/usr/bin/env node\n')
    launcher.chmod(0o700)
    node = prefix / 'bin/node'
    node.write_bytes(b'ELF-fake')
    node.chmod(0o700)
    exe = prefix / 'bin/codex'
    exe.symlink_to(launcher)
    env['PATH'] = str(prefix / 'bin') + os.pathsep + os.defpath
    fs = filesystem(codex_sandbox.permission_overrides(exe, work, env, readonly=False, network=False))
    assert fs[str(prefix)] == fs[str(package)] == fs[str(native)] == 'read'
    assert '/etc/resolv.conf' not in fs


@pytest.mark.skipif(not sys.platform.startswith('linux'), reason='requires Linux Codex sandbox')
@pytest.mark.parametrize('readonly', [False, True])
async def test_real_codex_sandbox_canary_unreachable(layout, readonly):
    exe = shutil.which('codex')
    if exe is None:
        pytest.skip('Codex is not installed')
    bwrap = shutil.which('bwrap')
    if bwrap is None:
        pytest.skip('bubblewrap is not installed; namespace proof unavailable')
    # This prerequisite does not weaken the sandbox test: skip only when the
    # host explicitly denies namespaces; all other errors remain failures.
    probe = subprocess.run([bwrap, '--unshare-user', '--unshare-pid', '--ro-bind', '/', '/',
                            '--', '/bin/true'], capture_output=True, text=True, timeout=10)
    if probe.returncode and any(s in probe.stderr.lower() for s in
                               ('operation not permitted', 'permission denied', 'no permissions', 'creating new namespace failed')):
        pytest.skip('host denies user namespaces: ' + probe.stderr.strip())
    assert probe.returncode == 0, probe.stderr
    work, env = layout
    env['PATH'] = os.environ.get('PATH', os.defpath)
    codex_sandbox._CACHE.clear()
    overrides = await codex_sandbox.preflight(Path(exe), work, env, readonly=readonly, network=True)
    assert filesystem(overrides)[':root'] == 'deny'
    assert not list(Path(env['CODEX_HOME']).glob('.con-canary-*'))
    assert not list(work.glob('.con-probe-*'))


async def test_cancelled_preflight_removes_canary(layout, monkeypatch):
    import asyncio
    from app.services import cli_probe
    work, env = layout
    canaries = []
    async def cancelled(args, **kwargs):
        if args[1] == '--version':
            return cli_probe.ProbeRun(0, 'synthetic-version', '')
        canaries.extend(args[-3:])
        assert Path(args[-3]).exists()
        raise asyncio.CancelledError()
    monkeypatch.setattr(cli_probe, 'run', cancelled)
    codex_sandbox._CACHE.clear()
    with pytest.raises(asyncio.CancelledError):
        await codex_sandbox.preflight(Path('/bin/sh'), work, env, readonly=False, network=False)
    assert canaries and all(not Path(p).exists() for p in canaries)
    assert not codex_sandbox._CACHE


def test_agent_folder_inside_the_data_folder_is_allowed_and_nothing_else_is(tmp_path, monkeypatch):
    from app.core import app_settings
    from app.services import workspaces
    data = tmp_path / 'data'
    agent = data / 'workspace' / 'agents' / '1'
    agent.mkdir(parents=True)
    other = data / 'other'
    other.mkdir()
    monkeypatch.setattr(type(settings), 'SQLITE_FILE', property(lambda self: data / 'con.db'), raising=False)
    monkeypatch.setattr(app_settings, 'get', lambda *a, **k: str(data / 'workspace'))
    monkeypatch.setattr(workspaces, 'canonical_workspace', lambda value: Path(value))
    monkeypatch.setattr(codex_sandbox.turn_sandbox, '_check_grant', lambda *a, **k: None)
    env = {'HOME': str(tmp_path / 'home')}
    codex_sandbox._check_path(agent, env, workspace=True)
    for target, kwargs in ((agent, {}), (other, {'workspace': True}), (data, {'workspace': True})):
        with pytest.raises(codex_sandbox.turn_sandbox.SandboxUnavailable):
            codex_sandbox._check_path(target, env, **kwargs)
