"""Default Linux filesystem/PID box with an optional isolated HTTP(S) gate.

A minimal root is populated from explicit mounts. Stage C shares the host
network. Stage D explicitly opts into a private network namespace.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import stat
import sys
from collections.abc import Iterable, Mapping

from app.core.config import settings
from app.desktop import profile


class SandboxUnavailable(OSError):
    """A requested sandbox cannot be provided; never retry unboxed."""


def _path(value: str | Path) -> Path:
    return Path(value).expanduser().resolve(strict=True)


def _contains(parent: Path, child: Path) -> bool:
    return parent == child or parent in child.parents


# Only the built-in /etc/resolv.conf mount may read these exact regular files.
# Ubuntu uses the stub file; other systemd-resolved setups use resolv.conf.
_RESOLVER_FILES = frozenset({
    Path("/run/systemd/resolve/stub-resolv.conf"),
    Path("/run/systemd/resolve/resolv.conf"),
})


def _check_grant(path: Path, *, resolver_file: bool = False) -> None:
    # An operator may expose runtime/login folders, never the database or its
    # enclosing data directory. Also reject a whole home or filesystem root.
    from app.core import app_settings
    from app.services.workspaces import canonical_workspace
    agents_root = canonical_workspace(app_settings.get("LOCAL_WORKSPACE_ROOT")) / "agents"
    protected = [settings.SQLITE_FILE.resolve(), Path.home().resolve(), agents_root]
    for value in (settings.ENGINE_PROCESS_DIR, settings.DECISION_LOG_DIR, settings.ATTACHMENTS_DIR):
        if value.strip():
            protected.append(Path(value).expanduser().resolve())
    trusted_resolver = resolver_file and path in _RESOLVER_FILES and path.is_file()
    unsafe_tree = any(_contains(Path(root), path) for root in ('/proc', '/sys', '/dev', '/run')) and not trusted_resolver
    if path in (Path('/'), Path('/tmp')) or unsafe_tree or any(_contains(path, item) for item in protected):
        raise SandboxUnavailable('A sandbox mount would expose the home or application data. Use a narrower folder.')
    from app.computers.service import state_root
    computer_data = state_root().resolve()
    if _contains(computer_data, path) or _contains(path, computer_data):
        raise SandboxUnavailable("A sandbox mount would expose computer permits or state.")
    docker_private = [Path.home() / '.docker', Path('/var/lib/docker')]
    if os.environ.get('DOCKER_CONFIG'):
        docker_private.append(Path(os.environ['DOCKER_CONFIG']).expanduser())
    docker_host = os.environ.get('DOCKER_HOST', '')
    if docker_host.startswith('unix://'):
        docker_private.append(Path(docker_host.removeprefix('unix://')))
    if any(_contains(root.resolve(), path) or _contains(path, root.resolve()) for root in docker_private):
        raise SandboxUnavailable("A sandbox mount would expose Docker access or configuration.")
    if path.exists() and stat.S_ISSOCK(path.stat().st_mode):
        raise SandboxUnavailable("Host sockets cannot be granted to a turn.")
    connector_data = Path(os.environ.get("CONNECTOR_DATA_DIR", str(Path.home() / ".local/share/chief-of-noumenon/connector"))).expanduser().resolve()
    if _contains(connector_data, path) or _contains(path, connector_data):
        raise SandboxUnavailable("A sandbox mount would expose connector credentials.")


def mailbox_mounts(launches: Iterable) -> list[Path]:
    """Only backend-created launch descriptors may grant a mailbox to a turn."""
    if not settings.TURN_SANDBOX_ENABLED:
        return []
    result = []
    for launch in launches:
        if launch is None:
            continue
        args = list(launch.args)
        if '--mailbox' in args:
            index = args.index('--mailbox')
            if index + 1 >= len(args):
                raise SandboxUnavailable('Invalid sandbox mailbox descriptor.')
            result.append(_path(args[index + 1]))
    return result


def _base() -> list[str]:
    if not sys.platform.startswith('linux') or profile.active():
        raise SandboxUnavailable('The turn sandbox requires Linux server mode; no engine was started.')
    exe = shutil.which('bwrap')
    if exe is None:
        raise SandboxUnavailable('The turn sandbox requires bubblewrap; no engine was started.')
    result = [exe, '--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid',
              '--unshare-ipc', '--unshare-uts', '--cap-drop', 'ALL', '--proc', '/proc',
              '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/run',
              '--setenv', 'TMPDIR', '/tmp', '--setenv', 'TMP', '/tmp', '--setenv', 'TEMP', '/tmp']
    if settings.TURN_SANDBOX_NETWORK_ENABLED:
        result.append('--unshare-net')
    # No host root bind: other users, application data, /run sockets and /tmp
    # mailboxes start absent. Keep standard runtimes read-only.
    for name in ('/usr', '/bin', '/sbin', '/lib', '/lib64'):
        if Path(name).exists():
            _check_grant(Path(name).resolve())
            result.extend(['--ro-bind', name, name])
    for name in ('/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/ssl',
                 '/etc/ld.so.cache', '/etc/localtime', '/etc/passwd', '/etc/group'):
        if Path(name).exists():
            source = Path(name).resolve()
            _check_grant(source, resolver_file=name == '/etc/resolv.conf')
            # Bind the resolved file at /etc/resolv.conf, without exposing the
            # host /run tree or recreating a dangling systemd-resolved symlink.
            result.extend(['--ro-bind', str(source), name])
    return result


class _RuntimeGrants:
    """Discover files without running an engine or reading its account config.

    Preserve links, rather than binding their targets over them: Node resolves
    its entry point before looking for package-relative imports and assets.
    """

    def __init__(self, env: Mapping[str, str], cwd: Path):
        self.env, self.cwd = env, cwd
        self.search_path = os.pathsep.join(str(Path(p) if Path(p).is_absolute() else cwd / p)
                                          for p in env.get('PATH', os.defpath).split(os.pathsep))
        self.paths: dict[Path, None] = {}
        self.links: dict[Path, str] = {}
        self.directories: set[Path] = set()
        self.seen: set[Path] = set()

    def grant(self, path: Path) -> Path:
        resolved = _path(path)
        _check_grant(resolved)
        if self.env.get('HOME') and _contains(resolved, Path(self.env['HOME']).resolve()):
            raise SandboxUnavailable('A runtime mount would expose the whole home. Use a dedicated install folder.')
        self.paths[resolved] = None
        return resolved

    def chain(self, path: Path) -> Path:
        if not path.is_absolute():
            path = self.cwd / path
        # Walk directory links too (for example an nvm "current" prefix).
        # Resolve a link before interpreting a following "..", as the kernel
        # does; lexical abspath/normpath would select a different executable.
        pending = list(path.parts[1:])
        current = Path('/')
        followed = 0
        while pending:
            piece = pending.pop(0)
            if piece == '..':
                current = current.parent
                continue
            candidate = current / piece
            if not candidate.is_symlink():
                current = candidate
                if pending:
                    self.directories.add(current)
                continue
            followed += 1
            if followed > 64:
                raise SandboxUnavailable(f'Engine symlink chain is too long: {path}. Reinstall the engine in a dedicated install folder.')
            target = os.readlink(candidate)
            _check_grant(candidate)
            _check_grant(_path(candidate))
            self.links[candidate] = target
            replacement = Path(target)
            if replacement.is_absolute():
                current = Path('/')
                pending = list(replacement.parts[1:]) + pending
            else:
                pending = list(replacement.parts) + pending
        return self.grant(current)

    def program(self, name: str, *, interpreter: bool = False) -> None:
        try:
            if '/' not in name:
                # Resolve using the turn's PATH, never the backend's ambient PATH.
                found = shutil.which(name, path=self.search_path)
                if not found:
                    raise FileNotFoundError(name)
                path = Path(found)
            else:
                path = Path(name)
            if not path.is_absolute():
                path = self.cwd / path
            resolved = self.chain(path)
            if not resolved.is_file():
                raise ValueError('the engine or interpreter must be a regular file')
            if interpreter and resolved.parent.name == 'bin':
                # nvm/pyenv/venv-style runtimes need their installation prefix.
                # A prefix of / or HOME is still refused by the normal check.
                self.grant(resolved.parent.parent)
            if resolved in self.seen:
                return
            self.seen.add(resolved)
            with resolved.open('rb') as handle:
                header = handle.read(4096)
            package = next((p for p in resolved.parents if (p / 'package.json').is_file()), None)
            if package is not None:
                self.grant(package)
                # npm's platform binaries can be optional sibling packages,
                # rather than children of the JavaScript launcher package.
                manifest = json.loads((package / 'package.json').read_text())
                modules = next((p for p in package.parents if p.name == 'node_modules'), None)
                if modules is not None:
                    for dependency_name in manifest.get('optionalDependencies', {}):
                        pieces = dependency_name.split('/')
                        if (len(pieces) == 1 or len(pieces) == 2 and pieces[0].startswith('@')) and all(
                            p and p not in ('.', '..') and '\\' not in p for p in pieces
                        ):
                            dependency = modules / dependency_name
                            if dependency.is_dir():
                                self.chain(dependency)
            if header.startswith(b'#!'):
                words = shlex.split(header.split(b'\n', 1)[0][2:].decode())
                if not words or not words[0].startswith('/'):
                    raise ValueError('invalid shebang')
                self.program(words[0], interpreter=True)
                if Path(words[0]).name == 'env':
                    rest = words[1:]
                    if rest[:1] == ['-S']:
                        rest = rest[1:]
                    if not rest or rest[0].startswith('-') or '=' in rest[0]:
                        raise ValueError('unsupported env shebang')
                    self.program(rest[0], interpreter=True)
            else:
                # Conventional native layouts: bin/tool with adjacent lib,
                # or a bundled tool.libs/vendor beside the executable.
                siblings = [resolved.parent / (resolved.name + '.libs'), resolved.parent / 'vendor']
                if resolved.parent.name == 'bin':
                    siblings += [resolved.parent.parent / name for name in ('lib', 'lib64')]
                for sibling in siblings:
                    if sibling.is_dir():
                        self.chain(sibling)
        except (OSError, RuntimeError, ValueError) as exc:
            raise SandboxUnavailable(
                f'Cannot safely expose engine runtime {name}: {exc}. '
                'Install the engine and interpreter in dedicated install folders, or grant a narrow runtime path with TURN_SANDBOX_READONLY_PATHS.'
            ) from exc

    def mounts(self, existing: list[str]) -> list[str]:
        covered = [Path(existing[i + 2]) for i, arg in enumerate(existing) if arg == '--ro-bind']
        result = []
        # A link target like "directory-link/../engine" needs the empty
        # directory traversed before "..", even though none of its files are
        # granted. --dir creates it without exposing host directory contents.
        for path in sorted(self.directories, key=lambda p: len(p.parts)):
            if not any(_contains(parent, path) for parent in covered):
                result += ['--dir', str(path)]
        # Parents first; skip aliases already present inside a mounted tree.
        for path in sorted(self.paths, key=lambda p: len(p.parts)):
            if not any(_contains(parent, path) for parent in covered):
                result += ['--ro-bind', str(path), str(path)]
                covered.append(path)
        for path, target in sorted(self.links.items(), key=lambda pair: len(pair[0].parts)):
            if not any(_contains(parent, path) for parent in covered):
                result += ['--symlink', target, str(path)]
        return result


def command(args: list[str], *, cwd: str | Path, env: Mapping[str, str],
            writable: Iterable[Path] = (), readonly: Iterable[Path] = (),
            workspace_readonly: bool = False, tool_worker: bool = False,
            engine_workspace: bool = False) -> list[str]:
    """Wrap one turn. Off preserves the existing argv exactly.

    Mount source paths are canonicalized to prevent a symlink granting a
    broader directory. Engine and interpreter installs are discovered read-only.
    """
    if settings.TURN_SANDBOX_NETWORK_ENABLED and not settings.TURN_SANDBOX_ENABLED:
        raise SandboxUnavailable('Network isolation requires the Linux turn sandbox; no engine was started.')
    if not settings.TURN_SANDBOX_ENABLED:
        return args
    result = _base()
    work = _path(cwd)
    if not work.is_dir():
        raise SandboxUnavailable('The sandbox workspace must be a directory.')
    # The legacy default workspace holds every agent. Per-agent workspaces are
    # fine; a shared root would reveal other agents even inside a mount box.
    from app.services.local_claude_runner import workspace_dir
    if work == workspace_dir():
        raise SandboxUnavailable('Choose an agent workspace before using the turn sandbox.')
    _check_grant(work)
    runtime = _RuntimeGrants(env, work)
    runtime.program(args[0])
    runtime.program(sys.executable, interpreter=True)
    runtime.grant(Path(sys.base_prefix))
    if env.get('SHELL'):
        runtime.program(env['SHELL'])
    read_paths = [Path(__file__).resolve().parents[1], Path(sys.prefix), *readonly]
    if not tool_worker:
        read_paths += [Path(x.strip()) for x in settings.TURN_SANDBOX_READONLY_PATHS.split(',') if x.strip()]
    write_paths = list(writable)
    if not engine_workspace:
        (read_paths if workspace_readonly else write_paths).insert(0, work)
    # Claude keeps login access only in the engine box, with native tools off.
    # Its workspace tools use a second box without login or owner path grants.
    # Codex app-server uses its own sandbox and does not enter this wrapper.
    program = Path(args[0]).name.lower()
    names = ('CODEX_HOME',) if 'codex' in program else ('CLAUDE_CONFIG_DIR',) if 'claude' in program else ()
    default = '.codex' if 'codex' in program else '.claude' if 'claude' in program else None
    login_paths = [Path(env[name]) for name in names if env.get(name)]
    if not login_paths and default and env.get('HOME'):
        login_paths = [Path(env['HOME']) / default]
    if not tool_worker:
        write_paths += [p for p in login_paths if p.exists()]
    if not tool_worker:
        write_paths += [Path(x.strip()) for x in settings.TURN_SANDBOX_WRITABLE_PATHS.split(',') if x.strip()]
    # A separate empty home also stays read-only when HOME lives under /tmp.
    # Named login folders and a workspace inside home remain separate mounts.
    home = Path(env['HOME']).expanduser().absolute() if env.get('HOME') else None
    if home is not None and home in (Path('/'), Path('/tmp'), Path('/run')):
        raise SandboxUnavailable('Choose a dedicated home directory before using the turn sandbox.')
    if env.get('HOME'):
        result.extend(['--tmpfs', str(home)])
    result.extend(runtime.mounts(result))
    result.extend(['--setenv', 'PATH', env.get('PATH', os.defpath)])
    for flag, paths in (('--ro-bind', read_paths), ('--bind', write_paths)):
        for path in dict.fromkeys(_path(p) for p in paths):
            _check_grant(path)
            if workspace_readonly and flag == '--bind' and (_contains(work, path) or _contains(path, work)):
                raise SandboxUnavailable('A writable grant overlaps the read-only workspace. Remove that grant for plan mode.')
            result.extend([flag, str(path), str(path)])
    if engine_workspace:
        # The engine must not auto-load workspace hooks/config or follow a
        # model-written context-file symlink into its own login folder.
        result.extend(['--tmpfs', str(work), '--remount-ro', str(work)])
    # Standard runtime trees can contain a Docker binary. Mask it as well as
    # leaving all host sockets and Docker configuration outside the box.
    docker = shutil.which('docker', path=env.get('PATH', os.defpath))
    if docker:
        result.extend(['--ro-bind', '/dev/null', str(Path(docker).resolve())])
    if tool_worker:
        private = [Path.home() / '.claude', Path.home() / '.codex', Path.home() / '.claude.json']
        private += [Path(os.environ[name]).expanduser() for name in ('CODEX_HOME', 'CLAUDE_CONFIG_DIR') if os.environ.get(name)]
        # Check all actual mounts, including runtime discovery and the workspace.
        # Owner grants are omitted altogether; symlink aliases resolve here.
        for index, flag in enumerate(result):
            if flag in ('--bind', '--ro-bind'):
                source = Path(result[index + 1]).resolve()
                if any(_contains(source, path.resolve()) or _contains(path.resolve(), source) for path in private):
                    raise SandboxUnavailable('A workspace tool mount would expose an engine login folder.')
    seal = ['--remount-ro', '/']
    if home is not None:
        seal += ['--remount-ro', str(home)]
    if settings.TURN_SANDBOX_NETWORK_ENABLED:
        from app.core import turn_egress
        helper = str(Path(turn_egress.__file__).resolve())
        # Only this backend-created UNIX socket is mounted from host /tmp.
        result.extend(['--ro-bind', '__TURN_EGRESS_SOCKET__', turn_egress.SOCKET_PATH])
        proxy = f'http://127.0.0.1:{turn_egress.PROXY_PORT}'
        for name in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'):
            result.extend(['--setenv', name, proxy])
        for name in ('NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy'):
            result.extend(['--unsetenv', name])
        # Runtime mounts are canonicalized. A venv's interpreter symlink can
        # reference an unmounted alias even when its real runtime was granted.
        interpreter = str(Path(sys.executable).resolve(strict=True))
        result.extend([*seal, '--chdir', str(work), '--', interpreter, helper, 'bridge', *args])
        return [sys.executable, helper, 'supervise', *result]
    result.extend([*seal, '--chdir', str(work), '--', *args])
    return result


def prepare(args: list[str], *, engine: str | None = None, **mounts) -> tuple[list[str], bool]:
    """Per-spawn verification and wrapping; never return a bare bypass command.

    The engine can only receive its no-inner-sandbox override as the payload of
    this verified box. Failure to exec bwrap cannot execute that payload outside
    it. No global availability cache or setting alone authorizes the override.
    """
    active = self_check()['status'] == 'available'
    payload = args
    if active and engine == 'claude':
        payload = [*args, '--settings', '{"sandbox":{"enabled":false},"disableAllHooks":true}']
    wrapped = command(payload, **mounts)
    if (wrapped is not payload) != active:
        raise SandboxUnavailable('Sandbox configuration changed during launch. Retry the turn; no engine was started.')
    return wrapped, active


def self_check() -> dict:
    """Probe the actual kernel permissions, without starting an engine.

    Called before each enabled turn, so a changed host configuration never
    falls through to an unboxed launch. No provider key is passed to the probe.
    """
    if settings.TURN_SANDBOX_NETWORK_ENABLED and not settings.TURN_SANDBOX_ENABLED:
        raise SandboxUnavailable('Network isolation requires the Linux turn sandbox; no engine was started.')
    if not settings.TURN_SANDBOX_ENABLED:
        return {'status': 'off', 'reason': 'Turn sandbox is off. Engine tools are not isolated from this machine.', 'network': 'unrestricted'}
    args = _base()
    # $$ is a shell in a fresh PID namespace; the backend's /proc entry must
    # not be the same process. The namespace identifier provides a direct check.
    script = 'test ! -e "$1" && readlink /proc/self/ns/pid'
    if settings.TURN_SANDBOX_NETWORK_ENABLED:
        script += ' && readlink /proc/self/ns/net'
    import tempfile
    data_root = settings.SQLITE_FILE.expanduser().resolve().parent
    data_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.sandbox-check-', dir=data_root) as folder:
        canary = Path(folder) / 'private-canary'
        canary.write_text('private', encoding='utf-8')
        try:
            done = subprocess.run([*args, '--', '/bin/sh', '-c', script, 'check', str(canary)],
                                  env={'PATH': '/usr/bin:/bin'}, capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError) as exc:
            raise SandboxUnavailable('The Linux sandbox self-check failed. Install bubblewrap and enable unprivileged user namespaces, or explicitly set TURN_SANDBOX_ENABLED=false. No engine was started.') from exc
    lines = done.stdout.strip().splitlines()
    if done.returncode or not lines or lines[0] == os.readlink('/proc/self/ns/pid') or not lines[0].startswith('pid:['):
        raise SandboxUnavailable('The Linux sandbox self-check failed. Install bubblewrap and enable unprivileged user namespaces, or explicitly set TURN_SANDBOX_ENABLED=false. No engine was started.')
    if settings.TURN_SANDBOX_NETWORK_ENABLED and (len(lines) != 2 or not lines[1].startswith('net:[')
                                                  or lines[1] == os.readlink('/proc/self/ns/net')):
        raise SandboxUnavailable('The Linux network namespace self-check failed; no engine was started.')
    return {'status': 'available', 'filesystem': 'explicit mounts', 'processes': 'private PID namespace',
            'network': 'public HTTP(S) gate' if settings.TURN_SANDBOX_NETWORK_ENABLED else 'unrestricted'}


if __name__ == '__main__':
    import json
    try:
        print(json.dumps(self_check()))
    except SandboxUnavailable as error:
        print(json.dumps({'status': 'unavailable', 'reason': str(error),
                          'network': 'unavailable' if settings.TURN_SANDBOX_NETWORK_ENABLED else 'unrestricted'}))
        raise SystemExit(1)


def status() -> dict:
    try:
        result = self_check()
    except SandboxUnavailable as exc:
        return {"status": "unavailable", "reason": str(exc), "protected": False}
    return {**result, "protected": result["status"] == "available"}
