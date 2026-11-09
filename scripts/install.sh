#!/usr/bin/env bash
# Local Linux install. No account sign-in, telemetry or automatic service start.
set -euo pipefail
umask 077
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
config_dir=${CHIEF_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/chief-of-noumenon}
install_service=false
enable_service=false
for arg in "$@"; do
  case "$arg" in
    --install-service) install_service=true ;;
    --enable-service) install_service=true; enable_service=true ;;
    --help) echo 'Usage: bash scripts/install.sh [--install-service | --enable-service]'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done
[[ $(uname -s) == Linux ]] || { echo 'This installer requires Linux.' >&2; exit 1; }
command -v node >/dev/null || { echo 'Install Node.js 22 or newer, then run this installer again.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo 'Node.js 22 or newer is required.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Install npm with Node.js, then run this installer again.' >&2; exit 1; }
command -v uv >/dev/null || { echo 'Install uv, then run this installer again.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Install Python 3, then run this installer again.' >&2; exit 1; }
# Canonicalize first: the env file must never land in the checkout.
config_dir=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).expanduser().resolve())' "$config_dir")
case "$config_dir/" in "$root/"*) echo 'CHIEF_CONFIG_DIR must be outside the checkout.' >&2; exit 1 ;; esac
mkdir -p -- "$config_dir"
chmod 700 -- "$config_dir"
export NEXT_TELEMETRY_DISABLED=1
# The static UI is served by app.server on the same origin as the API.
export NEXT_PUBLIC_API_BASE_URL=/api/v1
command -v bwrap >/dev/null || { echo 'Install bubblewrap, then run this installer again.' >&2; exit 1; }
(cd "$root/backend" && uv sync --frozen)
if [ ! -x "$root/connector/server/.venv/bin/python" ]; then
  uv venv "$root/connector/server/.venv"
fi
uv pip sync --python "$root/connector/server/.venv/bin/python" "$root/connector/server/requirements.lock"
(cd "$root/frontend" && npm ci --no-audit --no-fund)
node "$root/scripts/build-ui.js"
python3 - "$config_dir" "$root" <<'PY'
import base64
import os
from pathlib import Path
import secrets
import shlex
import stat
import sys
folder, root = map(Path, sys.argv[1:])
env = folder / 'server.env'
values = {
    'DATABASE_BACKEND': 'sqlite',
    'SQLITE_PATH': str(folder / 'data' / 'chief.db'),
    'TOKEN_ENCRYPTION_KEYS': base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),
    'HOOK_TOKEN': secrets.token_urlsafe(32),
    'LOCAL_EXECUTION_ENABLED': 'true',
    'LOCAL_TOOLS_ENABLED': 'true',
    'TURN_SANDBOX_ENABLED': 'true',
    'TURN_SANDBOX_NETWORK_ENABLED': 'true',
    'CONNECTOR_DATA_DIR': str(folder / 'data' / 'connector'),
    'LOCAL_WORKSPACE_ROOT': str(folder / 'workspaces'),
    'DECISION_LOG_DIR': str(folder / 'data' / 'decisions'),
    'ATTACHMENTS_DIR': str(folder / 'data' / 'attachments'),
    'OPEN_DOTS_UI_DIR': str(root / 'frontend' / 'out'),
    'OPEN_DOTS_HOST': '127.0.0.1',
    'OPEN_DOTS_PUBLIC_URL': os.environ.get('OPEN_DOTS_PUBLIC_URL', 'http://127.0.0.1:8000'),
    'CONNECTOR_OAUTH_CALLBACK_BASE': os.environ.get('OPEN_DOTS_PUBLIC_URL', 'http://127.0.0.1:8000').rstrip('/') + '/api/v1/integrations/connector/oauth',
    'CONNECTOR_ALLOWED_RETURN_ORIGINS': ','.join(dict.fromkeys([os.environ.get('OPEN_DOTS_PUBLIC_URL', 'http://127.0.0.1:8000').rstrip('/'), 'http://127.0.0.1:8000', 'http://localhost:8000'])),
    'OPEN_DOTS_PORT': '8000',
    'FRONTEND_ORIGINS': ','.join(dict.fromkeys([os.environ.get('OPEN_DOTS_PUBLIC_URL', 'http://127.0.0.1:8000').rstrip('/'), 'http://127.0.0.1:8000', 'http://localhost:8000'])),
    'NEXT_TELEMETRY_DISABLED': '1',
}
try:
    fd = os.open(env, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
except FileExistsError:
    info = env.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
        raise SystemExit('Existing server.env must be a regular file owned by you with mode 0600; nothing was overwritten.')
else:
    with os.fdopen(fd, 'w') as out:
        out.write(''.join(f'{key}={shlex.quote(value)}\n' for key, value in values.items()))
(folder / 'data').mkdir(exist_ok=True)
connector_data = folder / 'data' / 'connector'
connector_data.mkdir(exist_ok=True, mode=0o700)
for name in ('.secret.key', '.admin_token'):
    path = connector_data / name
    if path.exists():
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise SystemExit('Connector secret files must be regular files with mode 0600.')
    else:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as output:
            output.write(secrets.token_urlsafe(32))
start = folder / 'start.sh'
if start.is_symlink():
    raise SystemExit('Refusing a symlink at start.sh.')
start.write_text('#!/usr/bin/env bash\nset -euo pipefail\nset -a\nsource ' + shlex.quote(str(env)) + '\nset +a\nexport CONNECTOR_DATA_DIR=' + shlex.quote(str(connector_data)) + '\nexec bash ' + shlex.quote(str(root / 'scripts' / 'start-local.sh')) + ' "$@"\n')
start.chmod(0o700)
PY
# Values are generated shell assignments, never printed. Existing keys stay intact.
("$config_dir/start.sh" migrate)
printf 'Ready. Start Chief of Noumenon with: %q\n' "$config_dir/start.sh"
echo 'Open http://127.0.0.1:8000 after starting it. The backend serves the built frontend and API together.'
echo 'Owner passphrase setup is shown on first open. Telegram is optional in Settings.'
if $install_service; then
  command -v systemctl >/dev/null || { echo 'systemctl is unavailable; use the start command above.' >&2; exit 1; }
  unit_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
  mkdir -p -- "$unit_dir"
  python3 - "$unit_dir/chief-of-noumenon.service" "$config_dir/start.sh" <<'PY'
from pathlib import Path
import sys
unit, start = sys.argv[1:]
if Path(unit).is_symlink():
    raise SystemExit('Refusing a symlink at the service unit.')
escaped = start.replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%')
Path(unit).write_text('[Unit]\nDescription=Chief of Noumenon\nAfter=network.target\n\n[Service]\nType=simple\nExecStart="' + escaped + '"\nRestart=on-failure\nUMask=0077\n\n[Install]\nWantedBy=default.target\n')
PY
  systemctl --user daemon-reload
  if $enable_service; then
    systemctl --user enable chief-of-noumenon.service
    echo 'User service enabled for future logins. Start it with: systemctl --user start chief-of-noumenon.service'
  else
    echo 'User service written but not enabled or started.'
  fi
else
  echo 'Optional user service: rerun with --install-service to write it, or --enable-service to enable it for future logins.'
fi
