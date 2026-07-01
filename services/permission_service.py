"""
Сервис для управления разрешениями карт (MapPermission).

Бизнес-логика:
- Создание/обновление/удаление разрешений
- Проверка дубликатов
- Работа с пользовательскими и ролевыми разрешениями
"""

from models import MapPermission, User
from extensions import db
from utils.logger import api_logger


def grant_map_permission(map_id: int, user_id: int, role: str) -> MapPermission:
    """
    Создать разрешение для пользователя на карту.

    Args:
        map_id: ID карты
        user_id: ID пользователя
        role: 'viewer', 'editor', 'admin'

    Returns:
        MapPermission: Созданное разрешение

    Raises:
        ValueError: Если разрешение уже существует
    """
    # Проверка на дубликат
    existing = MapPermission.query.filter_by(
        map_id=map_id, user_id=user_id
    ).first()
    if existing:
        raise ValueError("Permission already exists for this user")

    perm = MapPermission(map_id=map_id, user_id=user_id, role=role)
    db.session.add(perm)
    db.session.commit()
    api_logger.info(f"Permission granted: map_id={map_id}, user_id={user_id}, role={role}")
    return perm


def grant_map_role_permission(map_id: int, role: str) -> MapPermission:
    """
    Создать разрешение для роли на карту.

    Args:
        map_id: ID карты
        role: 'viewer' или 'editor'

    Returns:
        MapPermission: Созданное разрешение

    Raises:
        ValueError: Если разрешение для роли уже существует
    """
    # Проверка на дубликат
    existing = MapPermission.query.filter_by(map_id=map_id, role=role).first()
    if existing:
        raise ValueError("Role permission already exists")

    perm = MapPermission(map_id=map_id, role=role)
    db.session.add(perm)
    db.session.commit()
    api_logger.info(f"Role permission granted: map_id={map_id}, role={role}")
    return perm


def update_map_permission_role(perm_id: int, role: str) -> MapPermission:
    """
    Обновить роль в разрешении.

    Args:
        perm_id: ID разрешения
        role: Новая роль 'viewer', 'editor', 'admin'

    Returns:
        MapPermission: Обновлённое разрешение
    """
    perm = MapPermission.query.get_or_404(perm_id)
    perm.role = role
    db.session.commit()
    api_logger.info(f"Permission role updated: perm_id={perm_id}, role={role}")
    return perm


def revoke_map_permission(perm_id: int) -> None:
    """
    Удалить разрешение.

    Args:
        perm_id: ID разрешения
    """
    perm = MapPermission.query.get_or_404(perm_id)
    db.session.delete(perm)
    db.session.commit()
    api_logger.info(f"Permission revoked: perm_id={perm_id}")
