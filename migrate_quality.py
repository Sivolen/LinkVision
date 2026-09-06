#!/usr/bin/env python3
"""Одноразовая миграция для ICMP quality monitoring."""
import os
import sys
from sqlalchemy import create_engine, inspect, text

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import Config


def main():
    engine = create_engine(Config.SQLALCHEMY_DATABASE_URI)
    with engine.begin() as conn:
        inspector = inspect(engine)
        if not inspector.has_table("device"):
            raise RuntimeError("Таблица device отсутствует. Сначала выполните основные миграции.")

        columns = {c["name"] for c in inspector.get_columns("device")}
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

        if not inspector.has_table("device_quality_history"):
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
            conn.execute(text(
                "CREATE INDEX idx_device_quality_device_timestamp "
                "ON device_quality_history (device_id, timestamp)"
            ))
        else:
            print("device_quality_history уже существует")

    print("Quality monitoring migration completed successfully.")


if __name__ == "__main__":
    main()
