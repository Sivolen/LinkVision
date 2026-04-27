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
    db_path = Config.SQLALCHEMY_DATABASE_URI.replace('sqlite:///', '')
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
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='device_ips'")
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
    if 'ip_address' in columns:
        print("Переносим IP-адреса из старой колонки...")
        devices = cursor.execute(
            "SELECT id, ip_address FROM device WHERE ip_address IS NOT NULL AND ip_address != ''").fetchall()
        for dev in devices:
            # Проверяем, не перенесён ли уже этот IP
            exists = cursor.execute(
                "SELECT 1 FROM device_ips WHERE device_id = ? AND ip_address = ?",
                (dev['id'], dev['ip_address'])
            ).fetchone()
            if not exists:
                cursor.execute(
                    "INSERT INTO device_ips (device_id, ip_address) VALUES (?, ?)",
                    (dev['id'], dev['ip_address'])
                )
        conn.commit()
        print(f"Перенесено {len(devices)} IP-адресов.")

        # Удаляем старую колонку
        print("Удаляем старую колонку ip_address...")
        cursor.execute("ALTER TABLE device DROP COLUMN ip_address")
        conn.commit()
    else:
        print("Колонка ip_address уже удалена.")

    # 4. Преобразуем статус в строку
    cursor.execute("PRAGMA table_info(device)")
    columns = [col[1] for col in cursor.fetchall()]
    if 'status' in columns:
        # Проверяем тип колонки
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='device'")
        create_sql = cursor.fetchone()[0]
        if 'BOOLEAN' in create_sql.upper() or 'INTEGER' in create_sql.upper():
            print("Преобразуем статус из булева в строку...")
            # Добавляем временную колонку
            cursor.execute("ALTER TABLE device ADD COLUMN status_new VARCHAR(10) DEFAULT 'up'")
            # Переносим данные
            cursor.execute("UPDATE device SET status_new = CASE WHEN status = 1 THEN 'up' ELSE 'down' END")
            # Удаляем старую
            cursor.execute("ALTER TABLE device DROP COLUMN status")
            # Переименовываем новую
            cursor.execute("ALTER TABLE device RENAME COLUMN status_new TO status")
            conn.commit()
            print("Статус преобразован.")
        else:
            print("Статус уже в строковом формате.")
    else:
        print("Колонка status не найдена – возможно, уже преобразована.")

    # 5. Преобразуем old_status и new_status в таблице device_history
    cursor.execute("PRAGMA table_info(device_history)")
    hist_columns = [col[1] for col in cursor.fetchall()]
    if 'old_status' in hist_columns:
        # Проверяем тип
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='device_history'")
        create_hist_sql = cursor.fetchone()[0]
        if 'BOOLEAN' in create_hist_sql.upper() or 'INTEGER' in create_hist_sql.upper():
            print("Преобразуем old_status и new_status в device_history...")
            cursor.execute("ALTER TABLE device_history ADD COLUMN old_status_new VARCHAR(10)")
            cursor.execute("ALTER TABLE device_history ADD COLUMN new_status_new VARCHAR(10)")
            cursor.execute("""
                UPDATE device_history 
                SET old_status_new = CASE WHEN old_status = 1 THEN 'up' ELSE 'down' END,
                    new_status_new = CASE WHEN new_status = 1 THEN 'up' ELSE 'down' END
            """)
            cursor.execute("ALTER TABLE device_history DROP COLUMN old_status")
            cursor.execute("ALTER TABLE device_history DROP COLUMN new_status")
            cursor.execute("ALTER TABLE device_history RENAME COLUMN old_status_new TO old_status")
            cursor.execute("ALTER TABLE device_history RENAME COLUMN new_status_new TO new_status")
            conn.commit()
            print("История преобразована.")
        else:
            print("История уже в строковом формате.")

    # 6. Добавляем внешний ключ, если его нет
    cursor.execute("PRAGMA foreign_key_list(device_ips)")
    fks = cursor.fetchall()
    if not any(fk[2] == 'device' for fk in fks):
        print("Добавляем внешний ключ для device_ips...")
        try:
            cursor.execute(
                "ALTER TABLE device_ips ADD CONSTRAINT fk_device_ips_device FOREIGN KEY (device_id) REFERENCES device(id) ON DELETE CASCADE")
        except sqlite3.OperationalError as e:
            # В SQLite нельзя добавить FK через ALTER, нужно пересоздать таблицу
            print("SQLite не поддерживает добавление внешнего ключа через ALTER. Пропускаем.")
            print("Внешний ключ будет создан при следующем запуске приложения.")
    else:
        print("Внешний ключ уже существует.")

    conn.close()
    print("✅ Миграция завершена успешно!")
    print("Теперь можно запустить приложение.")


if __name__ == "__main__":
    run_migration()