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
            text(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        )
    }
    missing = sorted(required - existing)
    if missing:
        raise RuntimeError(
            "База не похожа на поддерживаемую LinkVision БД: отсутствуют таблицы "
            + ", ".join(missing)
        )


def _add_ordering_columns(conn):
    _require_tables(conn, ("map", "map_folder"))
    for table in ("map", "map_folder"):
        columns = {
            row[1] for row in conn.execute(text(f'PRAGMA table_info("{table}")'))
        }
        if "position" not in columns:
            print(f"Добавляем {table}.position...")
            conn.execute(
                text(
                    f'ALTER TABLE "{table}" ADD COLUMN position INTEGER NOT NULL DEFAULT 0'
                )
            )
    print("Миграция ordering завершена успешно.")


def _require_tables(conn, tables):
    existing = {
        row[0]
        for row in conn.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        )
    }
    missing = sorted(set(tables) - existing)
    if missing:
        raise RuntimeError("Отсутствуют таблицы: " + ", ".join(missing))


def _migrate_quality(conn):
    _require_tables(conn, ("device",))
    columns = {row[1] for row in conn.execute(text('PRAGMA table_info("device")'))}
    fields = {
        "quality_status": "VARCHAR(12) NOT NULL DEFAULT 'unknown'",
        "quality_latency_ms": "FLOAT",
        "quality_jitter_ms": "FLOAT",
        "quality_loss_percent": "FLOAT",
        "quality_last_check": "TIMESTAMP",
    }
    for name, definition in fields.items():
        if name not in columns:
            print(f"Добавление device.{name}")
            conn.execute(text(f"ALTER TABLE device ADD COLUMN {name} {definition}"))

    tables = {
        row[0]
        for row in conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table'")
        )
    }
    if "device_quality_history" not in tables:
        print("Создание device_quality_history")
        conn.execute(text("""
            CREATE TABLE device_quality_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL,
                timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                samples INTEGER NOT NULL DEFAULT 0,
                loss_percent FLOAT NOT NULL DEFAULT 100.0,
                latency_min_ms FLOAT,
                latency_avg_ms FLOAT,
                latency_max_ms FLOAT,
                jitter_ms FLOAT,
                quality VARCHAR(12) NOT NULL DEFAULT 'unknown',
                FOREIGN KEY(device_id) REFERENCES device(id) ON DELETE CASCADE
            )
        """))
        conn.execute(
            text(
                "CREATE INDEX idx_device_quality_device_timestamp "
                "ON device_quality_history (device_id, timestamp)"
            )
        )
    else:
        print("device_quality_history уже существует")


def _migrate_quality_profiles(conn):
    _require_tables(conn, ("device",))
    tables = {
        row[0]
        for row in conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table'")
        )
    }
    if "quality_profile" not in tables:
        print("Создание quality_profile")
        conn.execute(text("""
            CREATE TABLE quality_profile (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(64) NOT NULL UNIQUE,
                is_default BOOLEAN NOT NULL DEFAULT 0,
                loss_degraded_percent FLOAT NOT NULL DEFAULT 1.0,
                latency_degraded_ms FLOAT NOT NULL DEFAULT 50.0,
                jitter_degraded_ms FLOAT NOT NULL DEFAULT 10.0,
                loss_bad_percent FLOAT NOT NULL DEFAULT 5.0,
                latency_bad_ms FLOAT NOT NULL DEFAULT 100.0,
                jitter_bad_ms FLOAT NOT NULL DEFAULT 30.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(
            text(
                "CREATE INDEX idx_quality_profile_is_default ON quality_profile(is_default)"
            )
        )

    profile_count = conn.execute(
        text("SELECT COUNT(*) FROM quality_profile")
    ).scalar_one()
    default_count = conn.execute(
        text("SELECT COUNT(*) FROM quality_profile WHERE is_default = 1")
    ).scalar_one()
    if profile_count == 0:
        print("Создание профиля 'По умолчанию'")
        conn.execute(text("""
            INSERT INTO quality_profile (
                name, is_default, loss_degraded_percent, latency_degraded_ms,
                jitter_degraded_ms, loss_bad_percent, latency_bad_ms, jitter_bad_ms
            ) VALUES ('По умолчанию', 1, 1.0, 50.0, 10.0, 5.0, 100.0, 30.0)
        """))
    elif default_count == 0:
        first_id = conn.execute(
            text("SELECT id FROM quality_profile ORDER BY id LIMIT 1")
        ).scalar_one()
        conn.execute(text("UPDATE quality_profile SET is_default = 0"))
        conn.execute(
            text("UPDATE quality_profile SET is_default = 1 WHERE id = :id"),
            {"id": first_id},
        )
        print(f"Профиль ID={first_id} назначен профилем по умолчанию.")

    columns = {row[1] for row in conn.execute(text('PRAGMA table_info("device")'))}
    if "quality_profile_id" not in columns:
        print("Добавление device.quality_profile_id")
        conn.execute(
            text(
                "ALTER TABLE device ADD COLUMN quality_profile_id INTEGER "
                "REFERENCES quality_profile(id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX idx_device_quality_profile_id ON device(quality_profile_id)"
            )
        )
    else:
        print("device.quality_profile_id уже существует")


def _migrate_indexes(conn):
    _require_tables(conn, ("device", "group"))
    indexes = {idx[1] for idx in conn.execute(text('PRAGMA index_list("device")'))}
    if "idx_device_type_id" not in indexes:
        conn.execute(text("CREATE INDEX idx_device_type_id ON device (type_id)"))
        print("Создан idx_device_type_id")
    indexes = {idx[1] for idx in conn.execute(text('PRAGMA index_list("group")'))}
    if "idx_group_map_id" not in indexes:
        conn.execute(text('CREATE INDEX idx_group_map_id ON "group" (map_id)'))
        print("Создан idx_group_map_id")


def run_migration():
    db_path = _db_path()
    if not os.path.exists(db_path):
        raise RuntimeError(f"База данных не найдена: {db_path}")

    backup_path = (
        f"{db_path}.migration_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    )
    shutil.copy2(db_path, backup_path)
    print(f"Резервная копия перед миграцией: {backup_path}")

    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
    inspector = inspect(engine)

    with engine.begin() as conn:
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
            conn.execute(text("ALTER TABLE device DROP COLUMN ip_address"))
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
                else:
                    print("History columns already converted.")
        else:
            print("Table device_history does not exist, skipping.")

        _add_ordering_columns(conn)
        _migrate_quality(conn)
        _migrate_quality_profiles(conn)
        _migrate_indexes(conn)
        print("Все структурные миграции и индексы применены одной транзакцией.")


def add_indexes():
    """Совместимый режим: добавить индексы без повторного применения миграций."""
    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
    with engine.begin() as conn:
        _migrate_indexes(conn)
    print("Index migration completed successfully!")


if __name__ == "__main__":
    # Проверяем аргументы командной строки
    if len(sys.argv) > 1 and sys.argv[1] == "--indexes":
        add_indexes()
    else:
        run_migration()
