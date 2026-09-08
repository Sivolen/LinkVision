#!/bin/bash
# Явные миграции SQLite LinkVision.
# В проекте пока нет проверенной цепочки Alembic migrations, поэтому не
# создаём её автоматически через `flask db init/migrate`.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="python3"
if [ -x "$ROOT_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$ROOT_DIR/venv/bin/python"
elif [ -x "$ROOT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
fi

echo "🔧 LinkVision - применение SQLite миграций"
echo "============================================"

"$PYTHON_BIN" "$ROOT_DIR/migrate_db.py"
"$PYTHON_BIN" "$ROOT_DIR/migrate_ordering.py"
"$PYTHON_BIN" "$ROOT_DIR/migrate_quality.py"
"$PYTHON_BIN" "$ROOT_DIR/migrate_quality_profile.py"

"$PYTHON_BIN" - <<'PY'
import os
import sqlite3
from config import Config
from models import db
from services.db.schema_service import mark_sqlite_schema, validate_sqlite_database

path = Config.SQLALCHEMY_DATABASE_URI.replace("sqlite:///", "", 1)
if not os.path.isabs(path):
    path = os.path.join(Config.BASE_DIR, path)

result = validate_sqlite_database(path, db.metadata, expected_version=None)
if not result.valid:
    raise SystemExit(f"❌ Схема после миграций всё ещё несовместима: {result.message}")

# Structural validation succeeded. The old marker is intentionally not used
# as a migration gate: migrations above have just upgraded the actual schema.
# Only now advance the marker to the application version.
mark_sqlite_schema(path, Config.VERSION)
print(f"✅ Схема LinkVision {Config.VERSION} подтверждена.")
PY

echo "✅ Все явные миграции применены успешно."
