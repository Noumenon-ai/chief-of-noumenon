#!/usr/bin/env bash
# Own only the child processes this invocation starts.
set -euo pipefail
umask 077
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ ${1:-} == migrate ]]; then
  cd "$root/backend"
  exec .venv/bin/python -m app.server "$@"
fi
(cd "$root/connector/server" && exec .venv/bin/python -m app.serve) &
connector_pid=$!
cleanup() { kill "$connector_pid" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$root/backend"
.venv/bin/python -m app.server "$@" &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true; cleanup' EXIT
while true; do
  for pid in "$connector_pid" "$backend_pid"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      if wait "$pid"; then status=1; else status=$?; fi
      echo "A local service exited; stopping this invocation's child processes." >&2
      exit "$status"
    fi
  done
  sleep 1
done
