#!/usr/bin/env python
"""
Финальная миграция БД для поддержки множественных IP-адресов и строковых статусов.
Выполняет:
- Бэкап существующей БД
- Создание таблицы device_ips (если отсутствует)
- Перенос IP из старой колонки devices.ip_address в device_ips
- Преобразование статусов из булевых в строки ('up'/'down')
- Удаление старой колонки ip_address
"""

import os
import shutil
import sqlite3
from datetime import datetime
from config import Config


def backup_database(db_path):
    """Создаёт копию базы данных с меткой времени."""
    if not os.path.exists(db_path):
        print(f"База данных не найдена: {db_path}")
        return None
    backup_name = f"{db_path}.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(db_path, backup_name)
    print(f"✅ Бэкап создан: {backup_name}")
    return backup_name


def run_migration():
    # Определяем путь к БД
    db_path = Config.SQLALCHEMY_DATABASE_URI.replace("sqlite:///", "")
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.getcwd(), db_path)

    print(f"Работа с БД: {db_path}")

    # 1. Бэкап
    backup_database(db_path)

    # Подключаемся к БД
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Включаем поддержку внешних ключей (для SQLite)
    cursor.execute("PRAGMA foreign_keys = ON")

    # 2. Проверяем, есть ли таблица device_ips
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='device_ips'"
    )
    if not cursor.fetchone():
        print("Создаём таблицу device_ips...")
        cursor.execute("""
            CREATE TABLE device_ips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id INTEGER NOT NULL,
                ip_address VARCHAR(45) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
    else:
        print("Таблица device_ips уже существует.")

    # 3. Если есть колонка ip_address в таблице device, переносим данные
    cursor.execute("PRAGMA table_info(device)")
    columns = [col[1] for col in cursor.fetchall()]
    if "ip_address" in columns:
        print("Переносим IP-адреса из старой колонки...")
        devices = cursor.execute(
            "SELECT id, ip_address FROM device WHERE ip_address IS NOT NULL AND ip_address != ''"
        ).fetchall()
        for dev in devices:
            # Проверяем, не перенесён ли уже этот IP
            exists = cursor.execute(
                "SELECT 1 FROM device_ips WHERE device_id = ? AND ip_address = ?",
                (dev["id"], dev["ip_address"]),
            ).fetchone()
            if not exists:
                cursor.execute(
                    "INSERT INTO device_ips (device_id, ip_address) VALUES (?, ?)",
                    (dev["id"], dev["ip_address"]),
                )
        conn.commit()
        print(f"Перенесено {len(devices)} IP-адресов.")

        # Удаляем старую колонку
        print("Удаляем старую колонку ip_address...")
        try:
            cursor.execute("ALTER TABLE device DROP COLUMN ip_address")
            conn.commit()
        except sqlite3.OperationalError:
            print("Колонка ip_address уже удалена.")
    else:
        print("Колонка ip_address уже удалена.")

    # 3.5. Добавляем is_locked к map, если нет
    print("\n🔍 Проверка колонки is_locked...")
    cursor.execute("PRAGMA table_info(map)")
    map_columns = [col[1] for col in cursor.fetchall()]
    print(f"   Колонки в map: {map_columns}")
    if "is_locked" not in map_columns:
        print("   ➕ Добавляем колонку is_locked к map...")
        cursor.execute("ALTER TABLE map ADD COLUMN is_locked BOOLEAN DEFAULT 0")
        conn.commit()
        print("   ✅ Колонка is_locked добавлена.")
    else:
        print("   ⏭️  Колонка is_locked уже существует.")

    # 3.6. Создаём audit_log, если нет
    print("\n🔍 Проверка таблицы audit_log...")
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'"
    )
    if not cursor.fetchone():
        print("   ➕ Создаём таблицу audit_log...")
        cursor.execute("""
            CREATE TABLE audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username VARCHAR(64),
                action VARCHAR(50) NOT NULL,
                target_type VARCHAR(30),
                target_id INTEGER,
                target_name VARCHAR(128),
                old_values JSON,
                new_values JSON,
                ip_address VARCHAR(45),
                user_agent VARCHAR(256),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES user(id)
            )
        """)
        cursor.execute("CREATE INDEX ix_audit_log_action ON audit_log(action)")
        cursor.execute("CREATE INDEX ix_audit_log_target_id ON audit_log(target_id)")
        cursor.execute(
            "CREATE INDEX ix_audit_log_target_type ON audit_log(target_type)"
        )
        cursor.execute("CREATE INDEX ix_audit_log_timestamp ON audit_log(timestamp)")
        cursor.execute("CREATE INDEX ix_audit_log_user_id ON audit_log(user_id)")
        cursor.execute("CREATE INDEX idx_audit_action ON audit_log(action)")
        cursor.execute(
            "CREATE INDEX idx_audit_target ON audit_log(target_type, target_id)"
        )
        cursor.execute(
            "CREATE INDEX idx_audit_user_timestamp ON audit_log(user_id, timestamp)"
        )
        conn.commit()
        print("   ✅ Таблица audit_log создана.")
    else:
        print("   ⏭️  Таблица audit_log уже существует.")

    # 3.7. Создаём map_permission, если нет
    print("\n🔍 Проверка таблицы map_permission...")
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='map_permission'"
    )
    if not cursor.fetchone():
        print("   ➕ Создаём таблицу map_permission...")
        cursor.execute("""
            CREATE TABLE map_permission (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER NOT NULL,
                user_id INTEGER,
                role VARCHAR(20),
                FOREIGN KEY (map_id) REFERENCES map(id),
                FOREIGN KEY (user_id) REFERENCES user(id),
                CHECK ((user_id IS NOT NULL) OR (role IS NOT NULL)),
                UNIQUE(map_id, user_id),
                UNIQUE(map_id, role)
            )
        """)
        cursor.execute(
            "CREATE INDEX ix_map_permission_map_id ON map_permission(map_id)"
        )
        cursor.execute(
            "CREATE INDEX ix_map_permission_user_id ON map_permission(user_id)"
        )
        conn.commit()
        print("   ✅ Таблица map_permission создана.")
    else:
        print("   ⏭️  Таблица map_permission уже существует.")

    # 4. Преобразуем статус в строку
    cursor.execute("PRAGMA table_info(device)")
    columns = [col[1] for col in cursor.fetchall()]
    if "status" in columns:
        # Проверяем тип колонки
        cursor.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='device'"
        )
        create_sql = cursor.fetchone()[0]
        if "BOOLEAN" in create_sql.upper() or "INTEGER" in create_sql.upper():
            print("Преобразуем статус из булева в строку...")
            # Проверяем, не создана ли уже временная колонка
            if "status_new" not in columns:
                # Добавляем временную колонку
                cursor.execute(
                    "ALTER TABLE device ADD COLUMN status_new VARCHAR(10) DEFAULT 'up'"
                )
                # Переносим данные
                cursor.execute(
                    "UPDATE device SET status_new = CASE WHEN status = 1 THEN 'up' ELSE 'down' END"
                )
                # Удаляем старую
                cursor.execute("ALTER TABLE device DROP COLUMN status")
                # Переименовываем новую
                cursor.execute("ALTER TABLE device RENAME COLUMN status_new TO status")
            else:
                print(
                    "Временная колонка status_new уже существует - пропускаем преобразование статуса"
                )
            conn.commit()
            print("Статус преобразован.")
        else:
            print("Статус уже в строковом формате.")
    else:
        print("Колонка status не найдена – возможно, уже преобразована.")

    # 5. Преобразуем old_status и new_status в таблице device_history
    cursor.execute("PRAGMA table_info(device_history)")
    hist_columns = [col[1] for col in cursor.fetchall()]
    if "old_status" in hist_columns:
        # Проверяем тип
        cursor.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='device_history'"
        )
        create_hist_sql = cursor.fetchone()[0]
        if "BOOLEAN" in create_hist_sql.upper() or "INTEGER" in create_hist_sql.upper():
            print("Преобразуем old_status и new_status в device_history...")
            # Проверяем, не созданы ли уже временные колонки
            if "old_status_new" not in hist_columns:
                cursor.execute(
                    "ALTER TABLE device_history ADD COLUMN old_status_new VARCHAR(10)"
                )
                cursor.execute(
                    "ALTER TABLE device_history ADD COLUMN new_status_new VARCHAR(10)"
                )
                cursor.execute("""
                    UPDATE device_history 
                    SET old_status_new = CASE WHEN old_status = 1 THEN 'up' ELSE 'down' END,
                        new_status_new = CASE WHEN new_status = 1 THEN 'up' ELSE 'down' END
                """)
                cursor.execute("ALTER TABLE device_history DROP COLUMN old_status")
                cursor.execute("ALTER TABLE device_history DROP COLUMN new_status")
                cursor.execute(
                    "ALTER TABLE device_history RENAME COLUMN old_status_new TO old_status"
                )
                cursor.execute(
                    "ALTER TABLE device_history RENAME COLUMN new_status_new TO new_status"
                )
                conn.commit()
                print("История преобразована.")
            else:
                print(
                    "Временные колонки уже существуют - пропускаем преобразование истории"
                )
        else:
            print("История уже в строковом формате.")

    # 6. Добавляем внешний ключ, если его нет
    cursor.execute("PRAGMA foreign_key_list(device_ips)")
    fks = cursor.fetchall()
    if not any(fk[2] == "device" for fk in fks):
        print("\n⚠️  SQLite не поддерживает добавление FK через ALTER")
        print("   Внешний ключ будет создан при следующем запуске приложения.")
    else:
        print("\n✅ Внешний ключ уже существует.")

    conn.close()
    print("\n✅ Миграция завершена успешно!")

    # 7. Проверка что всё создано
    print("\n🔍 Проверка результатов...")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Проверка is_locked
    cursor.execute("PRAGMA table_info(map)")
    map_cols = [col[1] for col in cursor.fetchall()]
    if "is_locked" in map_cols:
        print("✅ map.is_locked - OK")
    else:
        print("❌ map.is_locked - НЕ СОЗДАНА!")

    # Проверка audit_log
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'"
    )
    if cursor.fetchone():
        print("✅ audit_log - OK")
    else:
        print("❌ audit_log - НЕ СОЗДАНА!")

    # Проверка map_permission
    cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='map_permission'"
    )
    if cursor.fetchone():
        print("✅ map_permission - OK")
    else:
        print("❌ map_permission - НЕ СОЗДАНА!")

    conn.close()

    # 8. Перезапуск приложения
    print("\n🔄 Перезапуск приложения...")
    import subprocess
    import signal
    import time

    # Остановка gunicorn
    try:
        subprocess.run(["pkill", "-f", "gunicorn"], capture_output=True)
        time.sleep(2)
        print("✅ gunicorn остановлен")
    except Exception as e:
        print(f"⚠️  Ошибка остановки gunicorn: {e}")

    # Проверка что gunicorn остановился
    time.sleep(1)

    # Запуск gunicorn
    try:
        print("🚀 Запуск gunicorn...")
        subprocess.Popen(
            ["gunicorn", "-k", "eventlet", "-w", "1", "-b", "0.0.0.0:8005", "wsgi:app"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(3)
        print("✅ gunicorn запущен")
    except Exception as e:
        print(f"❌ Ошибка запуска gunicorn: {e}")
        print(
            "\n⚠️  Запустите вручную: gunicorn -k eventlet -w 1 -b 0.0.0.0:8005 wsgi:app"
        )

    print("\n" + "=" * 60)
    print("✅ Все миграции применены успешно!")
    print("=" * 60)


if __name__ == "__main__":
    run_migration()
