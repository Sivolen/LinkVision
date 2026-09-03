#!/usr/bin/env python
"""Migrate sidebar ordering columns for an existing LinkVision SQLite DB."""

import os
import sqlite3

from config import Config


def _db_path() -> str:
    path = Config.SQLALCHEMY_DATABASE_URI.replace("sqlite:///", "", 1)
    return path if os.path.isabs(path) else os.path.join(Config.BASE_DIR, path)


def _require_tables(conn: sqlite3.Connection, tables: tuple[str, ...]) -> None:
    existing = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
    }
    missing = [table for table in tables if table not in existing]
    if missing:
        raise RuntimeError(
            "Невозможно применить миграцию ordering: отсутствуют таблицы "
            + ", ".join(missing)
            + ". Сначала примените базовые миграции."
        )


def run_migration() -> None:
    db_path = _db_path()
    if not os.path.exists(db_path):
        raise RuntimeError(f"База данных не найдена: {db_path}")

    conn = sqlite3.connect(db_path)
    try:
        _require_tables(conn, ("map", "map_folder"))
        conn.execute("PRAGMA foreign_keys = ON")
        for table in ("map", "map_folder"):
            columns = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
            if "position" not in columns:
                print(f"Добавляем {table}.position...")
                conn.execute(f'ALTER TABLE "{table}" ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
        conn.commit()
        print("Миграция ordering завершена успешно.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    run_migration()
