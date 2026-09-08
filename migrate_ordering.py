#!/usr/bin/env python3
"""Compatibility entrypoint; migration logic lives in migrate_db.py."""

from migrate_db import _add_ordering_columns, _db_path
from sqlalchemy import create_engine


def run_migration() -> None:
    engine = create_engine(__import__("config").Config.SQLALCHEMY_DATABASE_URI)
    with engine.begin() as conn:
        _add_ordering_columns(conn)


if __name__ == "__main__":
    run_migration()
