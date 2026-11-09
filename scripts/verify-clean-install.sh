#!/usr/bin/env bash
# Network-required proof in a disposable container. Never mounts host accounts.
set -euo pipefail
umask 077
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
command -v docker >/dev/null || { echo 'Docker is required.' >&2; exit 1; }
scratch=$(mktemp -d "$root/.clean-install-proof.XXXXXX")
name="chief-install-proof-$(basename "$scratch" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker image rm "$name" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 - "$root" "$scratch/source" <<'PY'
from pathlib import Path
import shutil
import subprocess
import sys
root, target = map(Path, sys.argv[1:])
files = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z']).split(b'\0')
for raw in files:
    if not raw:
        continue
    relative = Path(raw.decode())
    source = root / relative
    if not source.exists():  # a tracked deletion in this checkout
        continue
    source.resolve().relative_to(root)
    if source.name == '.env' or source.suffix in ('.db', '.sqlite', '.sqlite3'):
        raise SystemExit('Refusing a tracked secret/data file in the build context.')
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination, follow_symlinks=False)
# New job files must be in the tracked source set; never copy arbitrary ignored
# files to make the proof pass. The dispatcher stages/commits reviewed sources.
for name in ('scripts/verify-clean-install.mjs', 'backend/app/services/workspace_bridge.py',
             'backend/app/services/workspace_mailbox.py', 'backend/app/services/workspace_schema.py'):
    if not (target / name).is_file():
        raise SystemExit(f'New source must be tracked before clean-install proof: {name}')
PY
cat > "$scratch/Dockerfile" <<'DOCKER'
FROM node:22-bookworm-slim AS node
FROM ghcr.io/astral-sh/uv:0.9.5 AS uv
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 git build-essential bubblewrap curl && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=uv /uv /uvx /usr/local/bin/
COPY source /opt/chief
WORKDIR /opt/chief
ENV HOME=/opt/proof-home CHIEF_CONFIG_DIR=/opt/proof-config UV_CACHE_DIR=/opt/proof-cache/uv PLAYWRIGHT_BROWSERS_PATH=/opt/proof-cache/browsers
RUN mkdir -p /opt/proof-home /opt/proof-cache && cd desktop && npm ci --ignore-scripts --no-audit --no-fund && npx --no-install playwright install --with-deps chromium
CMD ["bash", "scripts/verify-clean-install-container.sh"]
DOCKER
# This runner is generated proof scaffolding, not a host environment copy.
cat > "$scratch/source/scripts/verify-clean-install-container.sh" <<'INNER'
#!/usr/bin/env bash
set -euo pipefail
umask 077
for engine in claude codex ollama lms gemini cursor; do
  if command -v "$engine" >/dev/null; then echo 'Unexpected engine in clean image.' >&2; exit 1; fi
done
bash scripts/install.sh
# Compare exact bytes without printing secret values or fingerprints.
cp "$CHIEF_CONFIG_DIR/server.env" /opt/proof-cache/server.before
cp "$CHIEF_CONFIG_DIR/data/connector/.secret.key" /opt/proof-cache/connector.before
cp "$CHIEF_CONFIG_DIR/data/connector/.admin_token" /opt/proof-cache/admin.before
bash scripts/install.sh
cmp "$CHIEF_CONFIG_DIR/server.env" /opt/proof-cache/server.before
cmp "$CHIEF_CONFIG_DIR/data/connector/.secret.key" /opt/proof-cache/connector.before
cmp "$CHIEF_CONFIG_DIR/data/connector/.admin_token" /opt/proof-cache/admin.before
echo 'PASS second install preserves server and connector keys'
"$CHIEF_CONFIG_DIR/start.sh" > /opt/proof-cache/app.log 2>&1 &
service_pid=$!
cleanup() { kill "$service_pid" 2>/dev/null || true; wait "$service_pid" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node scripts/verify-clean-install.mjs
INNER
docker build --tag "$name" "$scratch"
docker run --name "$name" --rm "$name"
