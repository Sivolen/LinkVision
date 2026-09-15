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


def _table_names(conn):
    return {
        row[0]
        for row in conn.execute(
            text(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        )
    }


def _columns(conn, table):
    return {row[1] for row in conn.execute(text(f'PRAGMA table_info("{table}")'))}


def _index_names(conn, table):
    return {row[1] for row in conn.execute(text(f'PRAGMA index_list("{table}")'))}


def _create_empty_schema(engine):
    """Create the current ORM schema for a brand-new SQLite database."""
    from models import db

    db.metadata.create_all(engine)
    print("Создана новая SQLite-база по текущей ORM-схеме.")


def _ensure_map_folder(conn):
    """Create/complete map_folder before any map.folder_id migration."""
    if "map_folder" not in _table_names(conn):
        print("Создание map_folder")
        conn.execute(text("""
            CREATE TABLE map_folder (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(128) NOT NULL,
                parent_id INTEGER,
                owner_id INTEGER NOT NULL,
                created_at TIMESTAMP,
                position INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(parent_id) REFERENCES map_folder(id),
                FOREIGN KEY(owner_id) REFERENCES user(id)
            )
        """))
        conn.execute(
            text("CREATE INDEX ix_map_folder_parent_id ON map_folder(parent_id)")
        )
        return

    columns = _columns(conn, "map_folder")
    if "name" not in columns:
        row_count = conn.execute(text("SELECT COUNT(*) FROM map_folder")).scalar_one()
        if row_count:
            raise RuntimeError(
                "map_folder.name отсутствует в непустой таблице; "
                "невозможно безопасно восстановить названия старых папок автоматически."
            )
        conn.execute(
            text("ALTER TABLE map_folder ADD COLUMN name VARCHAR(128) NOT NULL")
        )
    if "parent_id" not in columns:
        conn.execute(
            text(
                "ALTER TABLE map_folder ADD COLUMN parent_id INTEGER REFERENCES map_folder(id)"
            )
        )
    if "owner_id" not in columns:
        row_count = conn.execute(text("SELECT COUNT(*) FROM map_folder")).scalar_one()
        if row_count:
            raise RuntimeError(
                "map_folder.owner_id отсутствует в непустой таблице; "
                "невозможно безопасно определить владельцев старых папок автоматически."
            )
        conn.execute(
            text(
                "ALTER TABLE map_folder ADD COLUMN owner_id INTEGER NOT NULL REFERENCES user(id)"
            )
        )
    if "created_at" not in columns:
        conn.execute(text("ALTER TABLE map_folder ADD COLUMN created_at TIMESTAMP"))
    if "position" not in columns:
        conn.execute(
            text(
                "ALTER TABLE map_folder ADD COLUMN position INTEGER NOT NULL DEFAULT 0"
            )
        )
    if "ix_map_folder_parent_id" not in _index_names(conn, "map_folder"):
        conn.execute(
            text("CREATE INDEX ix_map_folder_parent_id ON map_folder(parent_id)")
        )


def _ensure_map_columns(conn):
    """Add map columns introduced with folders/order without replacing data."""
    _require_tables(conn, ("map",))
    columns = _columns(conn, "map")
    if "folder_id" not in columns:
        conn.execute(
            text(
                "ALTER TABLE map ADD COLUMN folder_id INTEGER REFERENCES map_folder(id)"
            )
        )
    if "position" not in columns:
        conn.execute(
            text("ALTER TABLE map ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
        )
    if "ix_map_folder_id" not in _index_names(conn, "map"):
        conn.execute(text("CREATE INDEX ix_map_folder_id ON map(folder_id)"))


def _ensure_permission_tables(conn):
    """Create folder/map permission tables when upgrading older databases."""
    tables = _table_names(conn)
    if "folder_permission" not in tables:
        print("Создание folder_permission")
        conn.execute(text("""
            CREATE TABLE folder_permission (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER NOT NULL,
                user_id INTEGER,
                role VARCHAR(20),
                FOREIGN KEY(folder_id) REFERENCES map_folder(id),
                FOREIGN KEY(user_id) REFERENCES user(id),
                CONSTRAINT check_folder_user_or_role
                    CHECK ((user_id IS NOT NULL) OR (role IS NOT NULL)),
                CONSTRAINT uq_folder_user UNIQUE (folder_id, user_id)
            )
        """))
        conn.execute(
            text(
                "CREATE INDEX ix_folder_permission_folder_id ON folder_permission(folder_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX ix_folder_permission_user_id ON folder_permission(user_id)"
            )
        )

    if "map_permission" not in tables:
        print("Создание map_permission")
        conn.execute(text("""
            CREATE TABLE map_permission (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER NOT NULL,
                user_id INTEGER,
                role VARCHAR(20),
                FOREIGN KEY(map_id) REFERENCES map(id),
                FOREIGN KEY(user_id) REFERENCES user(id),
                CONSTRAINT check_user_or_role
                    CHECK ((user_id IS NOT NULL) OR (role IS NOT NULL)),
                CONSTRAINT uq_map_user UNIQUE (map_id, user_id),
                CONSTRAINT uq_map_role UNIQUE (map_id, role)
            )
        """))
        conn.execute(
            text("CREATE INDEX ix_map_permission_map_id ON map_permission(map_id)")
        )
        conn.execute(
            text("CREATE INDEX ix_map_permission_user_id ON map_permission(user_id)")
        )


def _migrate_user_locale(conn):
    _require_tables(conn, ("user",))
    if "locale" not in _columns(conn, "user"):
        print("Добавление user.locale")
        conn.execute(text('ALTER TABLE "user" ADD COLUMN locale VARCHAR(8)'))


def _migrate_nested_groups(conn):
    _require_tables(conn, ("group",))
    if "parent_group_id" not in _columns(conn, "group"):
        print("Добавление group.parent_group_id")
        conn.execute(
            text(
                'ALTER TABLE "group" ADD COLUMN parent_group_id INTEGER REFERENCES "group"(id)'
            )
        )
    if "ix_group_parent_group_id" not in _index_names(conn, "group"):
        conn.execute(
            text('CREATE INDEX ix_group_parent_group_id ON "group"(parent_group_id)')
        )


def _ensure_supported_schema_objects(conn):
    """Apply all structural migrations required by the current ORM schema."""
    _require_base_tables(conn)
    _ensure_map_folder(conn)
    _ensure_map_columns(conn)
    _migrate_user_locale(conn)
    _migrate_nested_groups(conn)
    _ensure_permission_tables(conn)


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
    # Kept as a compatibility helper; the folder/map prerequisites are now
    # created by _ensure_supported_schema_objects().
    _ensure_map_folder(conn)
    _ensure_map_columns(conn)
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


def _sqlite_has_application_tables(engine):
    with engine.connect() as conn:
        return bool(_table_names(conn))


def run_migration():
    db_path = _db_path()
    database_exists = os.path.exists(db_path)
    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)

    if not database_exists or not _sqlite_has_application_tables(engine):
        _create_empty_schema(engine)
        return

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{db_path}.migration_backup_{stamp}"
    suffix = 1
    while os.path.exists(backup_path):
        backup_path = f"{db_path}.migration_backup_{stamp}_{suffix}"
        suffix += 1
    shutil.copy2(db_path, backup_path)
    print(f"Резервная копия перед миграцией: {backup_path}")

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
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(device_id) REFERENCES device(id) ON DELETE CASCADE
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

        _ensure_supported_schema_objects(conn)
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
