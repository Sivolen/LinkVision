#!/bin/bash
# Единая идемпотентная точка входа для всех SQLite-миграций LinkVision.
# Один запуск = одна резервная копия + одна транзакция структурных изменений
# + финальная проверка фактической схемы + обновление маркера версии.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="python3"
if [ -x "$ROOT_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$ROOT_DIR/venv/bin/python"
elif [ -x "$ROOT_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
fi

echo "🔧 LinkVision - единая миграция SQLite"
echo "======================================="

"$PYTHON_BIN" "$ROOT_DIR/migrate_db.py"

"$PYTHON_BIN" - <<'PY'
import os
from config import Config
from models import db
from services.db.schema_service import mark_sqlite_schema, validate_sqlite_database

path = Config.SQLALCHEMY_DATABASE_URI.replace("sqlite:///", "", 1)
if not os.path.isabs(path):
    path = os.path.join(Config.BASE_DIR, path)

# Старый version marker не является миграцией. Сначала проверяем реальную
# структуру, затем только после успеха продвигаем marker до версии приложения.
result = validate_sqlite_database(path, db.metadata, expected_version=None)
if not result.valid:
    raise SystemExit(f"❌ Схема после миграций несовместима: {result.message}")

mark_sqlite_schema(path, Config.VERSION)
print(f"✅ Схема LinkVision {Config.VERSION} подтверждена.")
PY

echo "✅ Все миграции применены единым запуском."
