#!/usr/bin/env bash
# Backward-compatible Linux wrapper. The migration workflow lives in manage.py.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="python3"
if [[ -x "$ROOT_DIR/venv/bin/python" ]]; then
    PYTHON_BIN="$ROOT_DIR/venv/bin/python"
elif [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
fi

exec "$PYTHON_BIN" "$ROOT_DIR/manage.py" migrate
