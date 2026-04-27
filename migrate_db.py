#!/usr/bin/env python
"""
Миграция БД для поддержки множественных IP и трёхстатусной системы.
Запускать один раз после обновления кода.
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
        # 1. Таблица device_ips
        if not inspector.has_table('device_ips'):
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
        columns = [c['name'] for c in inspector.get_columns('devices')]
        if 'ip_address' in columns:
            print("Migrating IP addresses...")
            rows = conn.execute(text("SELECT id, ip_address FROM devices WHERE ip_address IS NOT NULL AND ip_address != ''")).fetchall()
            for dev_id, ip in rows:
                exists = conn.execute(
                    text("SELECT 1 FROM device_ips WHERE device_id = :dev_id AND ip_address = :ip"),
                    {'dev_id': dev_id, 'ip': ip}
                ).fetchone()
                if not exists:
                    conn.execute(
                        text("INSERT INTO device_ips (device_id, ip_address) VALUES (:dev_id, :ip)"),
                        {'dev_id': dev_id, 'ip': ip}
                    )
            conn.commit()
            conn.execute(text("ALTER TABLE devices DROP COLUMN ip_address"))
            conn.commit()
        else:
            print("Column ip_address already removed.")

        # 3. Преобразование status в строку
        status_col = next((c for c in inspector.get_columns('devices') if c['name'] == 'status'), None)
        if status_col and str(status_col['type']) == 'BOOLEAN':
            print("Converting status column...")
            conn.execute(text("ALTER TABLE devices ADD COLUMN status_new VARCHAR(10)"))
            conn.execute(text("UPDATE devices SET status_new = CASE WHEN status = 1 THEN 'up' ELSE 'down' END"))
            conn.execute(text("ALTER TABLE devices DROP COLUMN status"))
            conn.execute(text("ALTER TABLE devices RENAME COLUMN status_new TO status"))
            conn.commit()
        else:
            print("Status column already converted.")

        # 4. Преобразование old_status/new_status в device_history
        if inspector.has_table('device_history'):
            hist_cols = [c['name'] for c in inspector.get_columns('device_history')]
            if 'old_status' in hist_cols:
                old_col = next(c for c in inspector.get_columns('device_history') if c['name'] == 'old_status')
                if str(old_col['type']) == 'BOOLEAN':
                    print("Converting history columns...")
                    conn.execute(text("ALTER TABLE device_history ADD COLUMN old_status_new VARCHAR(10)"))
                    conn.execute(text("ALTER TABLE device_history ADD COLUMN new_status_new VARCHAR(10)"))
                    conn.execute(text("""
                        UPDATE device_history 
                        SET old_status_new = CASE WHEN old_status = 1 THEN 'up' ELSE 'down' END,
                            new_status_new = CASE WHEN new_status = 1 THEN 'up' ELSE 'down' END
                    """))
                    conn.execute(text("ALTER TABLE device_history DROP COLUMN old_status"))
                    conn.execute(text("ALTER TABLE device_history DROP COLUMN new_status"))
                    conn.execute(text("ALTER TABLE device_history RENAME COLUMN old_status_new TO old_status"))
                    conn.execute(text("ALTER TABLE device_history RENAME COLUMN new_status_new TO new_status"))
                    conn.commit()
                else:
                    print("History columns already converted.")
        else:
            print("Table device_history does not exist, skipping.")

        print("Migration completed successfully!")

if __name__ == "__main__":
    run_migration()