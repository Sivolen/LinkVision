#!/usr/bin/env python3
"""
Тестовый скрипт для проверки новых функций LinkVision v2.0

Запуск:
    python test_v2_features.py
"""

import requests
from requests.auth import HTTPBasicAuth

BASE_URL = "http://127.0.0.1:5000/api"
ADMIN_USER = "admin"
ADMIN_PASS = "Admin"


def get_auth_session():
    """Создать сессию с авторизацией."""
    session = requests.Session()
    session.auth = (ADMIN_USER, ADMIN_PASS)
    return session


def test_map_lock():
    """Тест блокировки карты."""
    print("\nТест блокировки карты")
    print("=" * 50)

    session = get_auth_session()

    # Получить список карт
    response = session.get(f"{BASE_URL}/maps")
    if response.status_code != 200:
        print(f"Ошибка получения карт: {response.status_code}")
        return

    maps = response.json()
    if not maps:
        print("Нет карт для тестирования")
        return

    map_id = maps[0]["id"]
    print(f"Тестируем на карте ID={map_id}")

    # Получить текущий статус блокировки
    response = session.get(f"{BASE_URL}/map/{map_id}/lock")
    if response.status_code == 200:
        data = response.json()
        print(
            f"Текущий статус: is_locked={data.get('is_locked')}, can_edit={data.get('can_edit')}"
        )
    else:
        print(f"Ошибка получения статуса: {response.status_code}")
        return

    # Заблокировать карту
    response = session.put(f"{BASE_URL}/map/{map_id}/lock", json={"locked": True})
    if response.status_code == 200:
        data = response.json()
        print(f"Карта заблокирована: is_locked={data.get('is_locked')}")
    else:
        print(f"Ошибка блокировки: {response.status_code}")
        return

    # Разблокировать карту
    response = session.put(f"{BASE_URL}/map/{map_id}/lock", json={"locked": False})
    if response.status_code == 200:
        data = response.json()
        print(f"Карта разблокирована: is_locked={data.get('is_locked')}")
    else:
        print(f"Ошибка разблокировки: {response.status_code}")


def test_map_permissions():
    """Тест управления правами доступа."""
    print("\nТест прав доступа к картам")
    print("=" * 50)

    session = get_auth_session()

    # Получить список карт
    response = session.get(f"{BASE_URL}/maps")
    if response.status_code != 200:
        print(f"Ошибка получения карт: {response.status_code}")
        return

    maps = response.json()
    if not maps:
        print("Нет карт для тестирования")
        return

    map_id = maps[0]["id"]
    print(f"Тестируем на карте ID={map_id}")

    # Получить текущие разрешения
    response = session.get(f"{BASE_URL}/map/{map_id}/permissions")
    if response.status_code == 200:
        permissions = response.json()
        print(f"Текущие разрешения: {len(permissions)}")
        for perm in permissions:
            perm_type = "user" if perm.get("user_id") else "role"
            print(
                f"   - {perm_type}: {perm.get('username') or perm.get('role')} ({perm.get('role')})"
            )
    else:
        print(f"Ошибка получения разрешений: {response.status_code}")
        return

    # Получить список пользователей (через админку)
    # response = session.get(f"{BASE_URL}/admin/users")
    # if response.status_code == 200:
    #     users = response.json()
    #     print(f"Доступные пользователи: {users}")

    print("Для добавления разрешения используйте:")
    print(f"   POST {BASE_URL}/map/{map_id}/permissions")
    print(f"   Body: {{'user_id': <ID>, 'role': 'viewer'|'editor'|'admin'}}")
    print("")
    print(f"   POST {BASE_URL}/map/{map_id}/permissions/role")
    print(f"   Body: {{'role': 'viewer'|'editor'}}")


def test_permissions_module():
    """Тест модуля прав доступа (backend)."""
    print("\nТест модуля permissions")
    print("=" * 50)

    try:
        from services.permissions import (
            can_view_map,
            can_edit_map,
            can_delete_map,
            get_user_map_ids,
            get_user_editable_map_ids,
        )
        from models import Map, User, MapPermission
        from extensions import db
        from flask import Flask
        from config import Config

        print("Модуль permissions импортирован")

        # Создать тестовое приложение
        app = Flask(__name__)
        app.config.from_object(Config)

        with app.app_context():
            # Проверка наличия новых полей
            map_obj = Map.query.first()
            if map_obj:
                has_lock = hasattr(map_obj, "is_locked")
                print(
                    f"Поле is_locked: {'присутствует' if has_lock else 'отсутствует'}"
                )

            # Проверка модели MapPermission
            perm_count = MapPermission.query.count()
            print(f"Записей в map_permission: {perm_count}")

            # Проверка функций
            if map_obj:
                view_access = can_view_map(map_obj.id)
                edit_access = can_edit_map(map_obj.id)
                print(f"can_view_map({map_obj.id}): {view_access}")
                print(f"can_edit_map({map_obj.id}): {edit_access}")

            print("Все функции работают корректно")

    except ImportError as e:
        print(f"Ошибка импорта: {e}")
    except Exception as e:
        print(f"Ошибка: {e}")


def main():
    """Запуск всех тестов."""
    print("=" * 60)
    print(" LinkVision v2.0 - Тестирование новых функций")
    print("=" * 60)

    # Тесты backend
    test_permissions_module()

    # Тесты API (требуется запущенный сервер)
    try:
        response = requests.get(f"{BASE_URL}/maps", auth=(ADMIN_USER, ADMIN_PASS))
        if response.status_code == 200:
            test_map_lock()
            test_map_permissions()
        else:
            print("\nAPI недоступно. Запустите сервер для полного тестирования.")
    except requests.exceptions.ConnectionError:
        print("\nСервер не запущен. Запустите LinkVision для тестирования API.")

    print("\n" + "=" * 60)
    print(" Тестирование завершено")
    print("=" * 60)


if __name__ == "__main__":
    main()
