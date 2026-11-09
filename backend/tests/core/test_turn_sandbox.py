"""Mount planning, refusal and optional real-Linux namespace qualification."""
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from types import SimpleNamespace

import pytest

from app.core import turn_sandbox as box
from app.core.config import settings


@pytest.fixture
def enabled(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, 'TURN_SANDBOX_ENABLED', True)
    monkeypatch.setattr(settings, 'LOCAL_WORKSPACE_ROOT', str(tmp_path / 'shared'))
    monkeypatch.setattr(settings, 'TURN_SANDBOX_READONLY_PATHS', '')
    monkeypatch.setattr(settings, 'TURN_SANDBOX_WRITABLE_PATHS', '')
    monkeypatch.setattr(settings, 'SQLITE_PATH', str(tmp_path / 'data' / 'app.db'))
    return tmp_path


@pytest.fixture
def fake_linux(monkeypatch, enabled):
    monkeypatch.setattr(box.sys, 'platform', 'linux')
    monkeypatch.setattr(box.profile, 'active', lambda: False)
    engine = enabled / 'fake-codex'
    engine.write_text('#!/bin/sh\nexit 0\n')
    engine.chmod(0o755)
    which = box.shutil.which
    monkeypatch.setattr(box.shutil, 'which', lambda name, **kw: '/usr/bin/bwrap' if name == 'bwrap'
                        else str(engine) if name == 'codex' else which(name, **kw))
    return enabled


def test_off_is_exact_argv_and_does_not_probe(monkeypatch):
    monkeypatch.setattr(settings, 'TURN_SANDBOX_ENABLED', False)
    args = ['codex', 'app-server']
    assert box.command(args, cwd='/does-not-exist', env={}) is args
    assert box.self_check()['status'] == 'off'


@pytest.mark.parametrize('desktop,platform', [(True, 'linux'), (False, 'darwin'), (False, 'win32')])
def test_unsupported_enabled_refuses(monkeypatch, enabled, desktop, platform):
    monkeypatch.setattr(box.sys, 'platform', platform)
    monkeypatch.setattr(box.profile, 'active', lambda: desktop)
    with pytest.raises(box.SandboxUnavailable, match='Linux server'):
        box.command(['codex'], cwd=enabled, env={})


def test_missing_bwrap_refuses(monkeypatch, fake_linux):
    monkeypatch.setattr(box.shutil, 'which', lambda name: None)
    with pytest.raises(box.SandboxUnavailable, match='bubblewrap'):
        box.self_check()


def test_plan_has_minimal_root_private_proc_tmp_and_scoped_mailboxes(fake_linux):
    workspace = fake_linux / 'workspace'
    mailbox = fake_linux / 'mailbox'
    for path in (workspace, mailbox):
        path.mkdir()
    args = box.command(['codex', 'app-server'], cwd=workspace, env={}, writable=[mailbox])
    assert '--unshare-pid' in args and '--die-with-parent' in args and '--new-session' in args
    assert args[args.index('--proc') + 1] == '/proc'
    assert args[args.index('--tmpfs') + 1] == '/tmp'
    assert '--unshare-net' not in args
    assert ['--bind', str(workspace), str(workspace)] == args[args.index('--bind'):args.index('--bind') + 3]
    assert str(mailbox) in args
    assert not any(args[n + 1] == '/' for n, arg in enumerate(args[:-1]) if arg in ('--bind', '--ro-bind'))
    assert args[-3:] == ['--', 'codex', 'app-server']


def test_mounting_data_parent_or_symlink_to_home_refused(monkeypatch, fake_linux):
    workspace = fake_linux / 'workspace'
    workspace.mkdir()
    link = fake_linux / 'home-link'
    link.symlink_to(Path.home(), target_is_directory=True)
    for granted in (fake_linux, link):
        with pytest.raises(box.SandboxUnavailable, match='application data'):
            box.command(['codex'], cwd=workspace, env={}, writable=[granted])


def test_shared_legacy_workspace_refuses_other_agent_exposure(monkeypatch, fake_linux):
    from app.services import local_claude_runner
    monkeypatch.setattr(local_claude_runner, 'workspace_dir', lambda: fake_linux / 'local' / 'workspace')
    workspace = fake_linux / 'local' / 'workspace'
    (workspace / 'agents' / '1').mkdir(parents=True)
    with pytest.raises(box.SandboxUnavailable, match='agent workspace'):
        box.command(['codex'], cwd=workspace, env={})
    args = box.command(['codex'], cwd=workspace / 'agents' / '1', env={})
    assert str(workspace) not in args


def test_only_named_engine_login_is_exposed(fake_linux):
    home = fake_linux / 'home'
    for name in ('.codex', '.claude'):
        (home / name).mkdir(parents=True)
    workspace = fake_linux / 'workspace'
    workspace.mkdir()
    args = box.command(['codex'], cwd=workspace, env={'HOME': str(home)})
    assert str(home / '.codex') in args
    assert str(home / '.claude') not in args
    assert ('--tmpfs', str(home)) in list(zip(args, args[1:]))
    assert ('--remount-ro', str(home)) in list(zip(args, args[1:]))


@pytest.mark.parametrize('returncode,stdout', [(1, ''), (0, ''), (0, 'pid:[host]')])
def test_self_check_rejects_failed_or_host_namespace(monkeypatch, fake_linux, returncode, stdout):
    monkeypatch.setattr(box.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=returncode, stdout=stdout))
    monkeypatch.setattr(box.os, 'readlink', lambda path: 'pid:[host]')
    with pytest.raises(box.SandboxUnavailable, match='self-check failed'):
        box.self_check()


def test_blocking_launch_does_not_fall_back(monkeypatch, enabled):
    from app.services import local_claude_runner as runner
    monkeypatch.setattr(box, 'self_check', lambda: (_ for _ in ()).throw(box.SandboxUnavailable('no box')))
    monkeypatch.setattr(runner, '_child_env', lambda: {})
    monkeypatch.setattr(runner.subprocess, 'Popen', lambda *a, **k: pytest.fail('unboxed spawn'))
    with pytest.raises(box.SandboxUnavailable):
        runner.run_blocking(['engine'], stdin_text='hello', cwd=enabled, timeout_seconds=2,
                            max_output_bytes=100, sandbox=True)


@pytest.mark.asyncio
async def test_rpc_launch_does_not_fall_back(monkeypatch, enabled):
    from app.services.stdio_rpc import StdioRpc
    monkeypatch.setattr(box, 'self_check', lambda: (_ for _ in ()).throw(box.SandboxUnavailable('no box')))
    monkeypatch.setattr(asyncio, 'create_subprocess_exec', lambda *a, **k: pytest.fail('unboxed spawn'))
    with pytest.raises(box.SandboxUnavailable):
        await StdioRpc.spawn(['engine'], cwd=str(enabled), max_bytes=100, sandbox=True)


@pytest.mark.skipif(not sys.platform.startswith('linux') or not shutil.which('bwrap'), reason='requires real Linux bubblewrap')
def test_real_linux_private_files_process_namespace_and_writable_workspace(enabled):
    report = box.self_check()
    assert report['status'] == 'available'
    workspace = enabled / 'workspace'
    workspace.mkdir()
    canary = enabled / 'private-canary'
    canary.write_text('secret')
    args = box.command(['/bin/sh', '-c', 'test ! -e "$1" && echo ok > result && readlink /proc/self/ns/pid',
                        'check', str(canary)], cwd=workspace, env={})
    done = subprocess.run(args, capture_output=True, text=True, timeout=10, env={'PATH': '/usr/bin:/bin'})
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() != os.readlink('/proc/self/ns/pid')
    assert (workspace / 'result').read_text().strip() == 'ok'


def test_claude_reports_sandbox_refusal_without_generic_runner_error():
    from app.services.claude_adapter import ClaudeAdapter
    parser = SimpleNamespace(model=None, usage=None, init_seen=False, unflushed_text='')
    attempt = SimpleNamespace(normalizer=parser, error=box.SandboxUnavailable('Sandbox required but unavailable'))
    outcome = ClaudeAdapter()._outcome(SimpleNamespace(aborted=False), attempt, tools=False)
    assert outcome.error_code == 'sandbox_unavailable'
    assert outcome.error == 'Sandbox required but unavailable'


@pytest.mark.parametrize('target', [
    '/run/systemd/resolve/stub-resolv.conf',
    '/run/systemd/resolve/resolv.conf',
])
def test_builtin_resolver_symlink_mounts_only_trusted_file(monkeypatch, fake_linux, target):
    # Simulate Ubuntu's resolver layout on every platform, including macOS.
    resolve, exists, is_file = Path.resolve, Path.exists, Path.is_file
    monkeypatch.setattr(Path, 'resolve', lambda self, *a, **kw: Path(target) if str(self) == '/etc/resolv.conf' else resolve(self, *a, **kw))
    monkeypatch.setattr(Path, 'exists', lambda self: True if str(self) == '/etc/resolv.conf' else exists(self))
    monkeypatch.setattr(Path, 'is_file', lambda self: True if str(self) == target else is_file(self))
    args = box._base()
    mounts = [args[index + 1:index + 3] for index, arg in enumerate(args) if arg in ('--ro-bind', '--bind')]
    assert [target, '/etc/resolv.conf'] in mounts
    assert all(source != '/run' and destination != '/run' for source, destination in mounts)
    assert [mount for mount in mounts if mount[0].startswith('/run/')] == [[target, '/etc/resolv.conf']]
    # The exception is unavailable to operator-supplied runtime/login grants.
    with pytest.raises(box.SandboxUnavailable):
        box._check_grant(Path(target))


@pytest.mark.parametrize('target,regular_file', [
    ('/run/docker.sock', False),
    ('/run/private/data', True),
    ('/run/systemd/resolve', False),
    ('/run/systemd/resolve/stub-resolv.conf', False),
])
def test_resolver_symlink_rejects_unrelated_run_paths_or_nonfiles(monkeypatch, fake_linux, target, regular_file):
    resolve, exists, is_file = Path.resolve, Path.exists, Path.is_file
    monkeypatch.setattr(Path, 'resolve', lambda self, *a, **kw: Path(target) if str(self) == '/etc/resolv.conf' else resolve(self, *a, **kw))
    monkeypatch.setattr(Path, 'exists', lambda self: True if str(self) == '/etc/resolv.conf' else exists(self))
    monkeypatch.setattr(Path, 'is_file', lambda self: regular_file if str(self) == target else is_file(self))
    with pytest.raises(box.SandboxUnavailable):
        box._base()
    with pytest.raises(box.SandboxUnavailable):
        box._check_grant(Path(target))


def test_linux_default_is_on_without_owner_override(monkeypatch):
    from app.core.config import Settings
    monkeypatch.setattr(box.sys, 'platform', 'linux')
    monkeypatch.setattr(box.profile, 'active', lambda: False)
    monkeypatch.delenv('TURN_SANDBOX_ENABLED', raising=False)
    configured = Settings(_env_file=None, TOKEN_ENCRYPTION_KEYS='test')
    assert configured.TURN_SANDBOX_ENABLED is True


def test_unavailable_status_is_plain(monkeypatch):
    def unavailable():
        raise box.SandboxUnavailable('Install bubblewrap; no engine was started.')
    monkeypatch.setattr(box, 'self_check', unavailable)
    state = box.status()
    assert not state['protected'] and state['status'] == 'unavailable'
    assert 'bubblewrap' in state['reason']


def test_passing_self_check_reports_protection(monkeypatch):
    monkeypatch.setattr(box, 'self_check', lambda: {'status':'available'})
    assert box.status()['protected'] is True


def executable(path, content=b'fake native binary'):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    path.chmod(0o755)
    return path


def mounts(argv, flag='--ro-bind'):
    return [tuple(argv[i + 1:i + 3]) for i, arg in enumerate(argv) if arg == flag]


def test_install_chain_grants_files_and_preserves_all_aliases(fake_linux):
    home = fake_linux / 'home'
    binary = executable(home / '.local/share/claude/versions/123')
    second = home / '.local/share/claude/current'
    second.symlink_to('versions/123')
    first = home / '.local/bin/claude'
    first.parent.mkdir()
    first.symlink_to('../share/claude/current')
    work = fake_linux / 'work'
    work.mkdir()
    argv = box.command([str(first)], cwd=work, env={'HOME': str(home), 'PATH': str(first.parent)})
    assert (str(binary), str(binary)) in mounts(argv)
    assert ('../share/claude/current', str(first)) in mounts(argv, '--symlink')
    assert ('versions/123', str(second)) in mounts(argv, '--symlink')
    assert all(str(path) not in [source for source, _ in mounts(argv)] for path in (home, first.parent, binary.parent))
    assert argv[argv.index('PATH') + 1] == str(first.parent)
    assert ['--remount-ro', '/'] == argv[argv.index('--remount-ro'):argv.index('--remount-ro') + 2]


@pytest.mark.parametrize('shebang', ['#!/usr/bin/env node', '#!/usr/bin/env -S node --no-warnings', '#!{node}'])
def test_script_package_interpreter_prefix_and_directory_alias(fake_linux, shebang):
    home = fake_linux / 'home'
    prefix = home / '.nvm/versions/node/22'
    node = executable(prefix / 'bin/node')
    alias = home / '.nvm/current'
    alias.symlink_to('versions/node/22', target_is_directory=True)
    # The nearest package wins, not its enclosing application or home.
    outer = home / 'engines'
    outer.mkdir()
    (outer / 'package.json').write_text('{}')
    package = outer / 'node_modules/@openai/codex'
    script = executable(package / 'bin/codex.js', (shebang.format(node=node) + '\n').encode())
    (package / 'package.json').write_text('{"optionalDependencies":{"@openai/codex-linux-x64":"1"}}')
    dependency = package.parent / 'codex-linux-x64'
    dependency.mkdir()
    work = fake_linux / 'work'
    work.mkdir()
    argv = box.command([str(script)], cwd=work, env={'HOME': str(home), 'PATH': f'{alias}/bin:/usr/bin:/bin'})
    for path in (prefix, package, dependency):
        assert (str(path), str(path)) in mounts(argv)
    assert (str(outer), str(outer)) not in mounts(argv)
    if 'env' in shebang:
        assert ('versions/node/22', str(alias)) in mounts(argv, '--symlink')


def test_native_sibling_runtime_is_readonly_without_bin_folder(fake_linux):
    engine = executable(fake_linux / 'install/bin/engine')
    library = engine.parent.parent / 'lib'
    library.mkdir()
    work = fake_linux / 'work'
    work.mkdir()
    argv = box.command([str(engine)], cwd=work, env={})
    assert (str(library), str(library)) in mounts(argv)
    assert (str(engine), str(engine)) in mounts(argv)
    assert (str(engine.parent), str(engine.parent)) not in mounts(argv)


def test_symlink_parent_components_follow_kernel_resolution(fake_linux):
    target = executable(fake_linux / 'install/engine')
    (target.parent / 'child').mkdir()
    directory_link = fake_linux / 'jump'
    directory_link.symlink_to(target.parent / 'child', target_is_directory=True)
    launcher = fake_linux / 'launcher'
    launcher.symlink_to('jump/../engine')
    runtime = box._RuntimeGrants({}, fake_linux)
    assert runtime.chain(launcher) == launcher.resolve(strict=True) == target
    assert set(runtime.links) == {launcher, directory_link}
    assert list(runtime.paths) == [target]
    planned = runtime.mounts([])
    assert ('--dir', str(target.parent / 'child')) in list(zip(planned, planned[1:]))
    assert (str(target.parent / 'child'), str(target.parent / 'child')) not in mounts(planned)


@pytest.mark.parametrize('kind', ['home', 'root', 'database', 'data_parent', 'agents'])
def test_automatic_grants_cannot_bypass_protected_paths(monkeypatch, fake_linux, kind):
    from app.core import app_settings
    from app.services.workspaces import canonical_workspace
    home = fake_linux / 'home'
    home.mkdir()
    monkeypatch.setattr(Path, 'home', classmethod(lambda cls: home))
    forbidden = {'home': home, 'root': Path('/'), 'database': settings.SQLITE_FILE,
                 'data_parent': settings.SQLITE_FILE.parent,
                 'agents': canonical_workspace(app_settings.get('LOCAL_WORKSPACE_ROOT')) / 'agents'}[kind]
    if kind == 'database':
        forbidden.parent.mkdir(parents=True, exist_ok=True)
        forbidden.write_text('private')
    elif kind != 'root':
        forbidden.mkdir(parents=True, exist_ok=True)
    runtime = box._RuntimeGrants({'HOME': str(home)}, fake_linux)
    with pytest.raises(box.SandboxUnavailable, match='home or application data'):
        runtime.grant(forbidden)


def test_unsafe_interpreter_prefix_fails_with_actionable_error(fake_linux):
    home = fake_linux / 'home'
    node = executable(home / 'bin/node')
    script = executable(fake_linux / 'script', f'#!{node}\n'.encode())
    work = fake_linux / 'work'
    work.mkdir()
    with pytest.raises(box.SandboxUnavailable, match='dedicated install folder'):
        box.command([str(script)], cwd=work, env={'HOME': str(home)})


@pytest.mark.parametrize('broken', ['missing', 'loop', 'fifo', 'interpreter'])
def test_unusable_runtime_fails_closed_without_running_it(fake_linux, broken):
    engine = fake_linux / 'engine'
    if broken == 'loop':
        engine.symlink_to(engine)
    elif broken == 'fifo':
        os.mkfifo(engine)
    elif broken == 'interpreter':
        executable(engine, b'#!/usr/bin/env nonexistent-throwaway-interpreter\n')
    work = fake_linux / 'work'
    work.mkdir()
    with pytest.raises(box.SandboxUnavailable, match='Install the engine and interpreter in dedicated install folders'):
        box.command([str(engine)], cwd=work, env={})


@pytest.mark.parametrize('overlap', ['workspace', 'child', 'parent'])
def test_plan_rejects_writable_grant_overlapping_workspace(fake_linux, overlap):
    work = fake_linux / 'project/work'
    child = work / 'cache'
    child.mkdir(parents=True)
    grant = {'workspace': work, 'child': child, 'parent': work.parent}[overlap]
    with pytest.raises(box.SandboxUnavailable, match='read-only workspace'):
        box.command(['codex'], cwd=work, env={}, workspace_readonly=True, writable=[grant])


@pytest.mark.parametrize('engine', ['codex', 'claude', None])
@pytest.mark.parametrize('state', ['available', 'off', 'unavailable', 'changed'])
def test_inner_sandbox_overrides_only_inside_verified_box(monkeypatch, fake_linux, engine, state):
    work = fake_linux / 'work'
    work.mkdir()
    original = ['codex', 'app-server']
    def check():
        if state == 'unavailable':
            raise box.SandboxUnavailable('no namespaces')
        return {'status': 'available' if state == 'changed' else state}
    monkeypatch.setattr(box, 'self_check', check)
    monkeypatch.setattr(settings, 'TURN_SANDBOX_ENABLED', state in ('available', 'unavailable'))
    if state in ('unavailable', 'changed'):
        with pytest.raises(box.SandboxUnavailable):
            box.prepare(original, cwd=work, env={}, engine=engine)
        return
    argv, active = box.prepare(original, cwd=work, env={}, engine=engine)
    assert active == (state == 'available')
    if not active:
        assert argv is original
    else:
        assert argv[0] == '/usr/bin/bwrap'
        payload = argv[argv.index('--') + 1:]
        expected = original + (['--settings', '{"sandbox":{"enabled":false},"disableAllHooks":true}'] if engine == 'claude' else [])
        assert payload == expected


@pytest.mark.skipif(not sys.platform.startswith('linux') or not shutil.which('bwrap'), reason='requires real Linux bubblewrap')
@pytest.mark.parametrize('install', ['native', 'node'])
@pytest.mark.parametrize('plan', [False, True])
def test_real_linux_installed_engine_is_scoped_and_plan_readonly(enabled, install, plan):
    # Copy harmless runtimes, never invoke a real engine or read account data.
    home = enabled / 'fake-home'
    work = enabled / 'workspace'
    work.mkdir()
    (home / '.ssh').mkdir(parents=True)
    canary = home / '.ssh/canary'
    canary.write_text('must stay private')
    if install == 'native':
        binary = home / '.local/share/fake/versions/1'
        binary.parent.mkdir(parents=True)
        shutil.copy2('/bin/sh', binary)
        payload = ['-c', 'test ! -e "$1" && ! touch "$2/outside" && ! touch "$3" && '
                   'if [ "$4" = plan ]; then ! touch result; else echo ok > result; fi',
                   'check', str(canary), str(home), str(binary), 'plan' if plan else 'ask']
    else:
        node = shutil.which('node')
        if not node:
            pytest.skip('requires Node runtime for Node-style install qualification')
        prefix = home / '.nvm/versions/node/test'
        (prefix / 'bin').mkdir(parents=True)
        shutil.copy2(node, prefix / 'bin/node')
        package = prefix / 'lib/node_modules/fake-engine'
        binary = executable(package / 'bin/engine.js', b'''#!/usr/bin/env node
const fs = require('fs');
const assert = require('assert');
assert.equal(require('../package.json').name, 'fake-engine');
assert(!fs.existsSync(process.argv[2]));
assert.throws(() => fs.writeFileSync(process.argv[3] + '/outside', 'bad'));
assert.throws(() => fs.writeFileSync(__filename, 'bad'));
if (process.argv[4] === 'plan') assert.throws(() => fs.writeFileSync('result', 'bad'));
else fs.writeFileSync('result', 'ok');
''')
        (package / 'package.json').write_text('{"name":"fake-engine"}')
        payload = [str(canary), str(home), 'plan' if plan else 'ask']
    alias = home / '.local/bin/fake-engine'
    alias.parent.mkdir(parents=True, exist_ok=True)
    intermediate = binary.parent.parent / 'current'
    intermediate.symlink_to(binary)
    alias.symlink_to(intermediate)
    env = {'HOME': str(home), 'PATH': (f'{prefix}/bin:' if install == 'node' else '') + '/usr/bin:/bin'}
    assert box.self_check()['status'] == 'available'
    argv = box.command([str(alias), *payload], cwd=work, env=env, workspace_readonly=plan)
    done = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=15)
    assert done.returncode == 0, done.stderr
    assert (work / 'result').exists() is not plan
    assert canary.read_text() == 'must stay private'
    assert not (home / 'outside').exists()


@pytest.mark.parametrize('kind', ['permits', 'docker-config', 'docker-socket-parent'])
def test_computer_authority_cannot_be_explicitly_mounted(monkeypatch, fake_linux, kind):
    from app.computers import service
    work = fake_linux / 'workspace'
    work.mkdir()
    private = fake_linux / kind
    private.mkdir()
    if kind == 'permits':
        monkeypatch.setattr(service, 'state_root', lambda: private)
        target = private / 'grants'
        target.mkdir()
    elif kind == 'docker-config':
        monkeypatch.setenv('DOCKER_CONFIG', str(private))
        target = private
    else:
        monkeypatch.setenv('DOCKER_HOST', 'unix://' + str(private / 'docker.sock'))
        target = private
    with pytest.raises(box.SandboxUnavailable, match='computer permits|Docker'):
        box.command(['codex'], cwd=work, env={}, writable=[target])


@pytest.mark.parametrize('grant_type', ['readonly', 'writable'])
def test_tool_box_omits_owner_runtime_and_login_grants(fake_linux, monkeypatch, grant_type):
    work = fake_linux / 'work'
    work.mkdir()
    login = fake_linux / 'login'
    login.mkdir()
    monkeypatch.setenv('CLAUDE_CONFIG_DIR', str(login))
    monkeypatch.setattr(settings, 'TURN_SANDBOX_' + grant_type.upper() + '_PATHS', str(login))
    args = box.command(['/bin/sh', '-c', 'true'], cwd=work,
                       env={'HOME':'/tmp/worker'}, tool_worker=True)
    assert str(login) not in args
    assert (str(work), str(work)) in mounts(args, '--bind')


def test_tool_box_refuses_workspace_overlapping_login(fake_linux, monkeypatch):
    login = fake_linux / 'login'
    login.mkdir()
    monkeypatch.setenv('CODEX_HOME', str(login))
    with pytest.raises(box.SandboxUnavailable, match='login folder'):
        box.command(['/bin/sh'], cwd=login, env={}, tool_worker=True)


@pytest.mark.skipif(not sys.platform.startswith('linux') or not shutil.which('bwrap'), reason='requires real Linux bubblewrap')
@pytest.mark.parametrize('engine_name,login_var', [('claude', 'CLAUDE_CONFIG_DIR'), ('codex', 'CODEX_HOME')])
async def test_real_split_engine_and_workspace_canary(enabled, monkeypatch, engine_name, login_var):
    box.self_check()  # Namespace denial is a failure, not silent test exclusion.
    work = enabled / 'work'
    work.mkdir()
    login = enabled / 'login'
    login.mkdir()
    secret = login / 'synthetic-token'
    secret.write_text('planted-job8-canary')
    monkeypatch.setenv(login_var, str(login))
    (work / 'link').symlink_to(secret)
    engine = executable(enabled / f'scripted-{engine_name}', (
        f'#!/bin/sh\ncat "${login_var}/synthetic-token"\ntest ! -e link\n').encode())
    env = {'PATH':os.defpath, 'HOME':str(enabled/'engine-home'), login_var:str(login)}
    engine_args = box.command([str(engine)], cwd=work, env=env, engine_workspace=True)
    done = subprocess.run(engine_args, env=env, capture_output=True, text=True, timeout=10)
    assert done.returncode == 0, done.stderr
    assert done.stdout == 'planted-job8-canary'
    worker_env = {'PATH':os.defpath, 'HOME':'/tmp/workspace-home'}
    shell = box.command(['/bin/sh', '-c', 'test ! -e "$1" && ! cat "$1" && ! cat link && echo workspace-ok > result',
                         'check', str(secret)], cwd=work, env=worker_env, tool_worker=True)
    done = subprocess.run(shell, env=worker_env, capture_output=True, text=True, timeout=10)
    assert done.returncode == 0, done.stderr
    assert 'planted-job8-canary' not in done.stdout
    assert (work/'result').read_text().strip() == 'workspace-ok'
    from app.services import workspace_tool_worker
    for target in (str(secret), 'link'):
        args = box.command([sys.executable, '-I', workspace_tool_worker.__file__], cwd=work,
                           env=worker_env, tool_worker=True)
        data = {'workspace':str(work), 'name':'read', 'arguments':{'path':target}}
        done = subprocess.run(args, input=json.dumps(data), env=worker_env, capture_output=True, text=True, timeout=10)
        assert 'planted-job8-canary' not in done.stdout
        assert json.loads(done.stdout).get('error')

    # Exercise the same backend bridge used by the adapters, including its
    # real tool launcher. Only the human decision is synthesized.
    from unittest.mock import AsyncMock
    from app.services.provider_adapter import TurnContext
    from app.services.workspace_bridge import WorkspaceBridge
    monkeypatch.setattr(settings, 'LOCAL_TOOLS_ENABLED', True)
    ctx = TurnContext(thread_id=1, turn_id=1, prompt='canary', workspace=work, model=None, images=[], provider_session_id='test',
                      provider_state=None, resume=False, history=AsyncMock(), agent_id=1, approval_mode='ask')
    sink = SimpleNamespace(lost=False, emit=AsyncMock(return_value=True))
    gate = SimpleNamespace(open=AsyncMock(return_value=object()),
                           decide=AsyncMock(return_value=SimpleNamespace(kind='allow')))
    bridge = WorkspaceBridge(None, SimpleNamespace(ctx=ctx, recorder=sink, gate=gate, turn_id=1))
    import shlex
    try:
        for name, arguments in (
            ('shell', {'command': f'cat {shlex.quote(str(secret))}'}),
            ('read', {'path': 'link'}),
            ('shell', {'command': 'cat link'}),
        ):
            result = await bridge.execute(name, arguments)
            assert 'planted-job8-canary' not in json.dumps(result)
            payload = json.loads(result['content'][0]['text'])
            payload = json.loads(payload['untrusted_tool_data']) if 'untrusted_tool_data' in payload else payload
            assert payload.get('error') or payload.get('exit_code')
        assert gate.open.await_count == gate.decide.await_count == 3
    finally:
        await bridge.close()
