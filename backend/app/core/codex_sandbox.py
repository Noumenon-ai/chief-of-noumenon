"""Codex's native command sandbox. The app-server itself is trusted, unboxed.

Only synthetic canaries are inspected. No login file or user config is read.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile

from app.core import turn_sandbox
from app.core.config import settings

# Explicitly suppress user extensions before app-server starts. These are not
# a claim that native shell/exec tools can be disabled (0.166 ignores that).
ISOLATION_OVERRIDES = (
    'mcp_servers={}', 'web_search="disabled"', 'approvals_reviewer="user"',
    'features.apps=false', 'features.plugins=false', 'features.remote_plugin=false',
    'features.plugin_discovery_prefetch=false', 'features.hooks=false',
    'features.skip_host_skill_discovery=true', 'features.tool_call_mcp_elicitation=true',
    'features.multi_agent=false', 'features.multi_agent_v2=false',
    'features.shell_snapshot=false',
)
_CACHE: set[tuple] = set()


class ConfinementUnavailable(Exception):
    pass


def confinement_error(detail: str) -> str:
    return ("Codex cannot run this protected turn: " + detail +
            ". No unprotected run was started.")


def config_args(overrides: tuple[str, ...]) -> list[str]:
    return [arg for value in overrides for arg in ('-c', value)]


def login_home(env: dict[str, str]) -> Path:
    return Path(env.get('CODEX_HOME') or str(Path(env.get('HOME') or Path.home()) / '.codex')).expanduser().resolve()


def _check_path(path: Path, env: dict[str, str], *, resolver: bool = False, workspace: bool = False) -> None:
    turn_sandbox._check_grant(path, resolver_file=resolver)
    from app.computers.service import state_root
    home = Path(env.get('HOME') or Path.home()).resolve()
    private = [login_home(env), home / '.codex', home / '.ssh', home / '.claude',
               settings.SQLITE_FILE.resolve().parent, state_root().resolve()]
    private += [Path(value).expanduser().resolve() for value in
                (settings.ENGINE_PROCESS_DIR, settings.DECISION_LOG_DIR, settings.ATTACHMENTS_DIR) if value.strip()]
    private.append(Path(os.environ.get('CONNECTOR_DATA_DIR', str(home / '.local/share/chief-of-noumenon/connector'))).expanduser().resolve())
    contains = turn_sandbox._contains
    # The configured agents root may live in the data folder. The profile opens
    # only that bot's subtree and `:root` stays denied, so the database stays
    # out of reach. Any other folder under the data folder is still refused.
    from app.core import app_settings
    from app.services.workspaces import canonical_workspace
    agents = canonical_workspace(app_settings.get("LOCAL_WORKSPACE_ROOT")).resolve() / 'agents'
    agent_folder = workspace and contains(agents, path) and path != agents
    database_folder = settings.SQLITE_FILE.resolve().parent
    if contains(path, home) or any(contains(path, p) or (contains(p, path) and not (agent_folder and p == database_folder))
                                   for p in private):
        raise turn_sandbox.SandboxUnavailable('A Codex permission grant would expose login or application data.')


def permission_overrides(exe: Path, workspace: Path, env: dict[str, str], *, readonly: bool,
                         network: bool) -> tuple[str, ...]:
    work = workspace.resolve(strict=True)
    _check_path(work, env, workspace=True)
    runtime = turn_sandbox._RuntimeGrants(env, work)
    runtime.program(str(exe))
    # The same executable/interpreter/package discovery used by the turn box.
    paths = set(runtime.paths) | set(runtime.links)
    paths.update(Path(p) for p in ('/usr', '/bin', '/sbin', '/lib', '/lib64') if Path(p).exists())
    # Whole /etc: bubblewrap cannot bind single symlinked files such as
    # /etc/resolv.conf when the parent is absent. Secrets there are not world
    # readable, and the home, login and data folders stay denied.
    paths.add(Path('/etc'))
    if network:
        paths.update(Path(p) for p in ('/etc/resolv.conf',) if Path(p).exists())
    for path in tuple(paths):
        resolved = path.resolve(strict=True)
        _check_path(resolved, env, resolver=path == Path('/etc/resolv.conf'))
        paths.add(resolved)  # Preserve resolver and runtime symlink targets.
        # bubblewrap cannot create a symlink's mount point; /etc already holds it.
        if path.is_symlink() and turn_sandbox._contains(Path('/etc'), path):
            paths.discard(path)
    fs = {':root': 'deny', ':minimal': 'read'}
    fs.update({str(path): 'read' for path in sorted(paths)})
    fs[':workspace_roots'] = {'.': 'read' if readonly else 'write'}

    def toml(value):
        if isinstance(value, dict):
            return '{' + ','.join(json.dumps(k) + '=' + toml(v) for k, v in value.items()) + '}'
        return json.dumps(value)

    return ('default_permissions="con"',
            'permissions=' + toml({'con': {'filesystem': fs, 'network': {'enabled': network}}}),
            *ISOLATION_OVERRIDES)


async def preflight(exe: Path, workspace: Path, env: dict[str, str], *, readonly: bool,
                    network: bool) -> tuple[str, ...]:
    """Validate before each engine start; cache only successful identical checks.

    A fresh app-server per turn and explicit profile selection on resume avoid
    relying on a previous process's permission state. Kernel proof remains a
    probe of sandbox commands, not proof of every future engine tool path.
    """
    from app.services import cli_probe
    try:
        overrides = permission_overrides(exe, workspace, env, readonly=readonly, network=network)
        version = await cli_probe.run([str(exe), '--version'], timeout=8, cwd=str(workspace), env=env)
        if not version.ok:
            raise ConfinementUnavailable(confinement_error('the installed version could not be checked'))
        binary = exe.resolve().stat()
        work_stat = workspace.stat()
        key = (str(exe.resolve()), binary.st_mtime_ns, binary.st_size, version.stdout.strip(),
               str(workspace.resolve()), work_stat.st_dev, work_stat.st_ino, str(login_home(env)),
               env.get('HOME'), overrides)
        if key in _CACHE:
            return overrides
        login_home(env).mkdir(parents=True, exist_ok=True)
        # Keep the canary file open until cleanup; NamedTemporaryFile uses O_EXCL
        # and mode 0600. Never inspect any existing login file.
        with tempfile.NamedTemporaryFile(prefix='.con-canary-', dir=login_home(env)) as canary, \
                tempfile.NamedTemporaryFile(prefix='.con-probe-', dir=workspace) as readable:
            canary.write(b'chief-of-noumenon synthetic canary')
            canary.flush()
            readable.write(b'workspace-readable')
            readable.flush()
            output = Path(readable.name + '.write')
            script = ('if cat "$1" >/dev/null 2>&1; then exit 41; fi; '
                      'test ! -e "$1" || exit 42; cat "$2" >/dev/null || exit 43; ')
            script += ('if (echo probe > "$3") 2>/dev/null; then exit 44; fi; ' if readonly else
                       'echo probe > "$3" || exit 45; ')
            script += 'printf con-sandbox-ok'
            try:
                result = await cli_probe.run(
                    [str(exe), 'sandbox', *config_args(overrides), '--', '/bin/sh', '-c', script,
                     'con-check', canary.name, readable.name, str(output)],
                    timeout=15, cwd=str(workspace), env=env)
                if not result.ok or result.stdout.strip() != 'con-sandbox-ok':
                    raise ConfinementUnavailable(confinement_error(
                        'the login-denial and workspace sandbox check failed; check Codex and Linux user namespace support'))
            finally:
                output.unlink(missing_ok=True)
        _CACHE.add(key)
        return overrides
    except (OSError, ValueError, RuntimeError) as exc:
        raise ConfinementUnavailable(confinement_error('the sandbox profile or its canary could not be prepared')) from exc
