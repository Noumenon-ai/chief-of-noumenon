"""Shell installer exercised with local command stubs; no downloads/services."""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts' / 'install.sh'


@pytest.fixture
def install(tmp_path):
    project = tmp_path / 'checkout'
    (project / 'scripts').mkdir(parents=True)
    (project / 'backend' / '.venv' / 'bin').mkdir(parents=True)
    (project / 'frontend').mkdir()
    shutil.copyfile(SCRIPT, project / 'scripts' / 'install.sh')
    shutil.copyfile(SCRIPT.with_name('start-local.sh'), project / 'scripts' / 'start-local.sh')
    binaries = tmp_path / 'bin'; binaries.mkdir()
    log = tmp_path / 'calls'
    for name in ('node', 'npm', 'uv', 'systemctl', 'bwrap'):
        file = binaries / name
        file.write_text('#!/bin/sh\nprintf "%s\\n" "' + name + ' $*" >> "$INSTALL_TEST_LOG"\n')
        file.chmod(0o700)
    (binaries / 'python3').symlink_to(sys.executable)
    python = project / 'backend' / '.venv' / 'bin' / 'python'
    python.write_text('#!/bin/sh\nprintf "%s\\n" "python $*" >> "$INSTALL_TEST_LOG"\n')
    python.chmod(0o700)
    env = {**os.environ, 'PATH': str(binaries) + ':/usr/bin:/bin', 'INSTALL_TEST_LOG': str(log),
           'CHIEF_CONFIG_DIR': str(tmp_path / 'config'), 'XDG_CONFIG_HOME': str(tmp_path / 'xdg')}
    def run(*args):
        return subprocess.run(['bash', str(project / 'scripts' / 'install.sh'), *args], env=env, text=True, capture_output=True, timeout=10)
    return run, env, log, binaries


def test_syntax():
    assert subprocess.run(['bash', '-n', str(SCRIPT)]).returncode == 0


def test_install_is_idempotent_and_preserves_keys(install):
    run, env, log, _ = install
    result = run()
    assert result.returncode == 0, result.stderr
    file = Path(env['CHIEF_CONFIG_DIR']) / 'server.env'
    assert file.stat().st_mode & 0o777 == 0o600
    first = hashlib.sha256(file.read_bytes()).digest()
    assert run().returncode == 0
    assert hashlib.sha256(file.read_bytes()).digest() == first
    calls = log.read_text()
    assert 'uv sync --frozen' in calls and 'npm ci --no-audit --no-fund' in calls
    assert 'python -m app.server migrate' in calls
    assert 'uv pip sync --python' in calls and 'requirements.lock' in calls
    connector = file.parent / 'data/connector'
    for name in ('.secret.key', '.admin_token'):
        key = connector / name
        assert key.stat().st_mode & 0o777 == 0o600
        assert key.read_text() not in result.stdout
    assert 'systemctl' not in calls
    assert 'TOKEN_ENCRYPTION_KEYS' not in result.stdout


@pytest.mark.parametrize('flag,enabled', [('--install-service', False), ('--enable-service', True)])
def test_service_is_explicit(install, flag, enabled):
    run, env, log, _ = install
    result = run(flag)
    assert result.returncode == 0, result.stderr
    calls = log.read_text()
    assert ('systemctl --user enable' in calls) == enabled
    assert '--now' not in calls and 'systemctl --user start' not in calls
    assert (Path(env['XDG_CONFIG_HOME']) / 'systemd/user/chief-of-noumenon.service').exists()


def test_unsafe_existing_env_refused(install):
    run, env, _, _ = install
    folder = Path(env['CHIEF_CONFIG_DIR']); folder.mkdir()
    file = folder / 'server.env'; file.write_text('sentinel'); file.chmod(0o644)
    result = run()
    assert result.returncode != 0 and '0600' in result.stderr
    assert file.read_text() == 'sentinel'


def test_missing_uv_message(install):
    run, _, _, binaries = install
    (binaries / 'uv').unlink()
    result = run()
    assert result.returncode != 0 and 'Install uv' in result.stderr


def test_install_frontend_origin_matches_the_static_server(install):
    run, env, log, _ = install
    result = run()
    assert result.returncode == 0, result.stderr
    config = (Path(env['CHIEF_CONFIG_DIR']) / 'server.env').read_text()
    assert 'FRONTEND_ORIGINS=http://127.0.0.1:8000,http://localhost:8000' in config
    assert 'OPEN_DOTS_UI_DIR=' in config and '/frontend/out' in config
    assert 'http://127.0.0.1:8000' in result.stdout
    assert 'build-ui.js' in log.read_text()


@pytest.mark.parametrize('address', ['http://127.0.0.1:8000', 'http://localhost:8000', 'https://chief.example.test'])
def test_google_callbacks_and_return_origins_use_public_address(install, address):
    run, env, _, _ = install
    env['OPEN_DOTS_PUBLIC_URL'] = address
    result = run()
    assert result.returncode == 0, result.stderr
    content = (Path(env['CHIEF_CONFIG_DIR']) / 'server.env').read_text()
    assert f'OPEN_DOTS_PUBLIC_URL={address}' in content
    assert f'CONNECTOR_OAUTH_CALLBACK_BASE={address}/api/v1/integrations/connector/oauth' in content
    assert f'CONNECTOR_ALLOWED_RETURN_ORIGINS={address}' in content
    for alias in ['http://localhost:8000', 'http://127.0.0.1:8000']:
        assert alias in next(line for line in content.splitlines() if line.startswith('CONNECTOR_ALLOWED_RETURN_ORIGINS='))
