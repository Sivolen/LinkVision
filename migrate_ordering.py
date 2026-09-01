#!/usr/bin/env python
"""
Миграция БД: колонка position у map и map_folder — ручной порядок элементов
в дереве сайдбара (drag-and-drop). Идемпотентна, можно запускать повторно.
"""

import os
import sys
from sqlalchemy import create_engine, inspect, text

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import Config


def run_migration():
    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
    inspector = inspect(engine)

    with engine.connect() as conn:
        for table in ("map", "map_folder"):
            columns = [c["name"] for c in inspector.get_columns(table)]
            if "position" not in columns:
                print(f"Adding column {table}.position...")
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN position INTEGER DEFAULT 0"))
                conn.commit()
                print(f"Column {table}.position added.")
            else:
                print(f"Column {table}.position already exists.")

        print("Ordering migration completed successfully!")


if __name__ == "__main__":
    run_migration()
