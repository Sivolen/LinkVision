#!/usr/bin/env python3
"""Backward-compatible wrapper for the single supported SQLite migration entrypoint."""

from config import Config
from migrate_db import run_migration as _run_migration
from models import db
from services.db.schema_service import mark_sqlite_schema, validate_sqlite_database
import os


def run_migration():
    if not Config.SQLALCHEMY_DATABASE_URI.startswith("sqlite:///"):
        raise RuntimeError("fix_db.py поддерживает только SQLite.")

    path = Config.SQLALCHEMY_DATABASE_URI.replace("sqlite:///", "", 1)
    if not os.path.isabs(path):
        path = os.path.join(Config.BASE_DIR, path)

    print("⚠️ fix_db.py устарел: используется единая точка входа apply_migrations.sh.")
    _run_migration()

    result = validate_sqlite_database(path, db.metadata, expected_version=None)
    if not result.valid:
        raise RuntimeError(f"После миграции схема несовместима: {result.message}")

    mark_sqlite_schema(path, Config.VERSION)
    print(f"✅ База данных успешно приведена к схеме LinkVision {Config.VERSION}.")


if __name__ == "__main__":
    run_migration()
