#!/usr/bin/env python3
"""Compatibility wrapper for the historical database-fix command.

Use ``apply_migrations.sh`` for normal upgrades. This wrapper remains so older
installation instructions do not silently execute the old destructive script.
It never restarts gunicorn and never replaces the database file.
"""

import os

from config import Config
from migrate_db import run_migration as run_base_migration
from migrate_ordering import run_migration as run_ordering_migration
from models import db
from services.db.schema_service import mark_sqlite_schema, validate_sqlite_database


def run_migration():
    if not Config.SQLALCHEMY_DATABASE_URI.startswith("sqlite:///"):
        raise RuntimeError("fix_db.py поддерживает только SQLite.")

    path = Config.SQLALCHEMY_DATABASE_URI.replace("sqlite:///", "", 1)
    if not os.path.isabs(path):
        path = os.path.join(Config.BASE_DIR, path)

    print("⚠️ fix_db.py устарел: используется единый безопасный набор миграций.")
    print("⚠️ Перед запуском остановите приложение/worker, чтобы БД не изменялась параллельно.")

    run_base_migration()
    run_ordering_migration()

    result = validate_sqlite_database(path, db.metadata, expected_version=Config.VERSION)
    if not result.valid:
        raise RuntimeError(f"После миграции схема несовместима: {result.message}")

    mark_sqlite_schema(path, Config.VERSION)
    print(f"✅ База данных успешно приведена к схеме LinkVision {Config.VERSION}.")


if __name__ == "__main__":
    run_migration()


if __name__ == "__main__":
    run_migration()
