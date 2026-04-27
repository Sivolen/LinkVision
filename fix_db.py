#!/usr/bin/env python
import sqlite3
import os
from config import Config


def main():
    # Получаем путь к БД из конфига
    db_path = Config.SQLALCHEMY_DATABASE_URI.replace('sqlite:///', '')
    if not os.path.isabs(db_path):
        db_path = os.path.join(os.getcwd(), db_path)

    print(f"База данных: {db_path}")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Включаем поддержку внешних ключей
    cursor.execute("PRAGMA foreign_keys = ON")

    # Проверяем существование таблицы devices
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='devices'")
    if not cursor.fetchone():
        print("ОШИБКА: таблица 'devices' не существует. Сначала создайте её.")
        conn.close()
        return

    # Проверяем, есть ли уже внешний ключ в device_ips
    cursor.execute("PRAGMA foreign_key_list(device_ips)")
    fks = cursor.fetchall()
    if any(fk[2] == 'devices' and fk[3] == 'device_id' for fk in fks):
        print("✅ Внешний ключ уже существует. Ничего не делаем.")
        conn.close()
        return

    print("Внешний ключ отсутствует. Пересоздаём таблицу device_ips с сохранением данных...")

    # Отключаем проверку внешних ключей на время операции
    cursor.execute("PRAGMA foreign_keys = OFF")

    # Переименовываем старую таблицу
    cursor.execute("ALTER TABLE device_ips RENAME TO device_ips_old")

    # Создаём новую таблицу с правильным внешним ключом
    cursor.execute("""
        CREATE TABLE device_ips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL,
            ip_address VARCHAR(45) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        )
    """)

    # Копируем данные из старой таблицы
    cursor.execute("""
        INSERT INTO device_ips (id, device_id, ip_address, created_at)
        SELECT id, device_id, ip_address, created_at FROM device_ips_old
    """)

    # Удаляем старую таблицу
    cursor.execute("DROP TABLE device_ips_old")

    # Включаем проверку внешних ключей обратно
    cursor.execute("PRAGMA foreign_keys = ON")
    conn.commit()
    conn.close()

    print("✅ Таблица device_ips успешно пересоздана с внешним ключом.")
    print("Теперь запустите приложение — ошибка должна исчезнуть.")


if __name__ == "__main__":
    main()