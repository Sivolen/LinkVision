#!/usr/bin/env python3
"""Одноразовая миграция для профилей качества ICMP (QualityProfile).

Создаёт таблицу quality_profile, добавляет device.quality_profile_id
и профиль "По умолчанию" с порогами, которые раньше были захардкожены
в calculate_quality. Идемпотентна: повторный запуск ничего не меняет.
"""

import os
import shutil
import sys
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


def main():
    db_path = _db_path()
    if not os.path.exists(db_path):
        raise RuntimeError(f"База данных не найдена: {db_path}")

    backup_path = (
        f"{db_path}.migration_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    )
    shutil.copy2(db_path, backup_path)
    print(f"Резервная копия перед миграцией: {backup_path}")

    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
    with engine.begin() as conn:
        inspector = inspect(engine)
        if not inspector.has_table("device"):
            raise RuntimeError(
                "Таблица device отсутствует. Сначала выполните основные миграции."
            )

        # 1. Таблица quality_profile
        if not inspector.has_table("quality_profile"):
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
            conn.execute(text(
                "CREATE INDEX idx_quality_profile_is_default ON quality_profile(is_default)"
            ))
            # Пороги совпадают с прежними дефолтами calculate_quality —
            # поведение существующих устройств не меняется.
            conn.execute(text("""
                INSERT INTO quality_profile (name, is_default, loss_degraded_percent,
                    latency_degraded_ms, jitter_degraded_ms, loss_bad_percent,
                    latency_bad_ms, jitter_bad_ms)
                VALUES ('По умолчанию', 1, 1.0, 50.0, 10.0, 5.0, 100.0, 30.0)
            """))
            print("Профиль 'По умолчанию' создан.")
        else:
            print("quality_profile уже существует")

        # 2. Колонка device.quality_profile_id
        columns = {c["name"] for c in inspector.get_columns("device")}
        if "quality_profile_id" not in columns:
            print("Добавление device.quality_profile_id")
            conn.execute(text(
                "ALTER TABLE device ADD COLUMN quality_profile_id INTEGER "
                "REFERENCES quality_profile(id)"
            ))
            conn.execute(text(
                "CREATE INDEX idx_device_quality_profile_id ON device(quality_profile_id)"
            ))
        else:
            print("device.quality_profile_id уже существует")

    print("Quality profile migration completed successfully.")


if __name__ == "__main__":
    main()
