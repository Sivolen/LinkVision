#!/usr/bin/env python
"""
Миграция БД для поддержки множественных IP и трёхстатусной системы.
Запускать один раз после обновления кода.
"""

import os
import sys
import shutil
from datetime import datetime
from sqlalchemy import create_engine, inspect, text

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import Config


def _db_path():
    uri = Config.SQLALCHEMY_DATABASE_URI
    if not uri.startswith("sqlite:///"):
        raise RuntimeError("Этот скрипт поддерживает только SQLite DATABASE_URL.")
    path = uri.replace("sqlite:///", "", 1)
    return path if os.path.isabs(path) else os.path.join(Config.BASE_DIR, path)


def _require_base_tables(conn):
    required = {"user", "device", "map"}
    existing = {
        row[0]
        for row in conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        )
    }
    missing = sorted(required - existing)
    if missing:
        raise RuntimeError(
            "База не похожа на поддерживаемую LinkVision БД: отсутствуют таблицы "
            + ", ".join(missing)
        )


def run_migration():
    db_path = _db_path()
    if not os.path.exists(db_path):
        raise RuntimeError(f"База данных не найдена: {db_path}")

    backup_path = f"{db_path}.migration_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(db_path, backup_path)
    print(f"Резервная копия перед миграцией: {backup_path}")

    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
    inspector = inspect(engine)

    with engine.connect() as conn:
        _require_base_tables(conn)
        # 1. Таблица device_ips
        if not inspector.has_table("device_ips"):
            print("Creating table device_ips...")
            conn.execute(text("""
                CREATE TABLE device_ips (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id INTEGER NOT NULL,
                    ip_address VARCHAR(45) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()
        else:
            print("Table device_ips already exists.")

        # 2. Перенос IP из старой колонки, если она есть
        columns = [c["name"] for c in inspector.get_columns("device")]
        if "ip_address" in columns:
            print("Migrating IP addresses...")
            rows = conn.execute(
                text(
                    "SELECT id, ip_address FROM device WHERE ip_address IS NOT NULL AND ip_address != ''"
                )
            ).fetchall()
            for dev_id, ip in rows:
                exists = conn.execute(
                    text(
                        "SELECT 1 FROM device_ips WHERE device_id = :dev_id AND ip_address = :ip"
                    ),
                    {"dev_id": dev_id, "ip": ip},
                ).fetchone()
                if not exists:
                    conn.execute(
                        text(
                            "INSERT INTO device_ips (device_id, ip_address) VALUES (:dev_id, :ip)"
                        ),
                        {"dev_id": dev_id, "ip": ip},
                    )
            conn.commit()
            conn.execute(text("ALTER TABLE device DROP COLUMN ip_address"))
            conn.commit()
        else:
            print("Column ip_address already removed.")

        # 3. Преобразование status в строку
        status_col = next(
            (c for c in inspector.get_columns("device") if c["name"] == "status"), None
        )
        if status_col and str(status_col["type"]) == "BOOLEAN":
            print("Converting status column...")
            conn.execute(text("ALTER TABLE device ADD COLUMN status_new VARCHAR(10)"))
            conn.execute(
                text(
                    "UPDATE device SET status_new = CASE WHEN status = 1 THEN 'up' ELSE 'down' END"
                )
            )
            conn.execute(text("ALTER TABLE device DROP COLUMN status"))
            conn.execute(text("ALTER TABLE device RENAME COLUMN status_new TO status"))
            conn.commit()
        else:
            print("Status column already converted.")

        # 4. Преобразование old_status/new_status в device_history
        if inspector.has_table("device_history"):
            hist_cols = [c["name"] for c in inspector.get_columns("device_history")]
            if "old_status" in hist_cols:
                old_col = next(
                    c
                    for c in inspector.get_columns("device_history")
                    if c["name"] == "old_status"
                )
                if str(old_col["type"]) == "BOOLEAN":
                    print("Converting history columns...")
                    conn.execute(
                        text(
                            "ALTER TABLE device_history ADD COLUMN old_status_new VARCHAR(10)"
                        )
                    )
                    conn.execute(
                        text(
                            "ALTER TABLE device_history ADD COLUMN new_status_new VARCHAR(10)"
                        )
                    )
                    conn.execute(text("""
                        UPDATE device_history 
                        SET old_status_new = CASE WHEN old_status = 1 THEN 'up' ELSE 'down' END,
                            new_status_new = CASE WHEN new_status = 1 THEN 'up' ELSE 'down' END
                    """))
                    conn.execute(
                        text("ALTER TABLE device_history DROP COLUMN old_status")
                    )
                    conn.execute(
                        text("ALTER TABLE device_history DROP COLUMN new_status")
                    )
                    conn.execute(
                        text(
                            "ALTER TABLE device_history RENAME COLUMN old_status_new TO old_status"
                        )
                    )
                    conn.execute(
                        text(
                            "ALTER TABLE device_history RENAME COLUMN new_status_new TO new_status"
                        )
                    )
                    conn.commit()
                else:
                    print("History columns already converted.")
        else:
            print("Table device_history does not exist, skipping.")

        print("Migration completed successfully!")


def add_indexes():
    """Добавление недостающих индексов для оптимизации запросов (пункт 3.4)."""
    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
    inspector = inspect(engine)

    with engine.connect() as conn:
        # 1. Индекс на Device.type_id
        if not inspector.has_table("device"):
            print("Table device not found, skipping index creation.")
            return

        # Проверяем наличие индекса для type_id
        indexes = [idx["name"] for idx in inspector.get_indexes("device")]
        type_id_index_name = "idx_device_type_id"

        if type_id_index_name not in indexes:
            print(f"Creating index {type_id_index_name} on device.type_id...")
            conn.execute(text(f"CREATE INDEX {type_id_index_name} ON device (type_id)"))
            conn.commit()
            print(f"Index {type_id_index_name} created.")
        else:
            print(f"Index {type_id_index_name} already exists.")

        # 2. Индекс на Group.map_id
        if not inspector.has_table("groups"):
            print("Table groups not found, skipping index creation.")
            return

        indexes = [idx["name"] for idx in inspector.get_indexes("groups")]
        group_map_id_index_name = "idx_group_map_id"

        if group_map_id_index_name not in indexes:
            print(f"Creating index {group_map_id_index_name} on groups.map_id...")
            conn.execute(
                text(f"CREATE INDEX {group_map_id_index_name} ON groups (map_id)")
            )
            conn.commit()
            print(f"Index {group_map_id_index_name} created.")
        else:
            print(f"Index {group_map_id_index_name} already exists.")

        print("Index migration completed successfully!")


if __name__ == "__main__":
    # Проверяем аргументы командной строки
    if len(sys.argv) > 1 and sys.argv[1] == "--indexes":
        add_indexes()
    else:
        run_migration()
