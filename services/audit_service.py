"""
Сервис аудита действий.

Логирование всех значимых действий в системе:
- CRUD операции с картами, устройствами, пользователями
- Изменения прав доступа
- Блокировка/разблокировка карт
- Вход/выход пользователей
"""

from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from flask import request
from flask_login import current_user
from extensions import db
from models import AuditLog
from utils.logger import main_logger
from sqlalchemy import func


def log_action(
    action: str,
    target_type: str,
    target_id: Optional[int] = None,
    target_name: Optional[str] = None,
    old_values: Optional[Dict[str, Any]] = None,
    new_values: Optional[Dict[str, Any]] = None,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
) -> AuditLog:
    """
    Записать действие в журнал аудита.

    Args:
        action: Тип действия (create_device, update_map, delete_user, etc.)
        target_type: Тип объекта (device, map, user, permission)
        target_id: ID объекта
        target_name: Название объекта (имя карты, устройства)
        old_values: Старые значения (для обновлений)
        new_values: Новые значения
        user_id: ID пользователя (по умолчанию current_user)
        username: Имя пользователя (по умолчанию current_user.username)

    Returns:
        AuditLog: Созданная запись журнала
    """
    # Определяем пользователя
    if user_id is None:
        user_id = current_user.id if current_user.is_authenticated else None

    if username is None:
        username = current_user.username if current_user.is_authenticated else "system"

    # Получаем IP и User-Agent
    ip_address = None
    user_agent = None

    if request:
        ip_address = request.headers.get("X-Forwarded-For", request.remote_addr)
        user_agent = request.headers.get("User-Agent", "")[:256]

    # Создаём запись
    log_entry = AuditLog(
        user_id=user_id,
        username=username,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_name=target_name,
        old_values=old_values,
        new_values=new_values,
        ip_address=ip_address,
        user_agent=user_agent,
    )

    db.session.add(log_entry)

    try:
        db.session.commit()
        main_logger.debug(f"AUDIT: {action} {target_type}/{target_id} by {username}")
    except Exception as e:
        db.session.rollback()
        main_logger.error(f"Audit log error: {e}")
        # Не прерываем работу приложения из-за ошибки аудита

    return log_entry


# ============================================================================
# Convenience функции для стандартных действий
# ============================================================================


def log_map_action(
    action: str,
    map_id: int,
    map_name: str,
    old_values: Optional[Dict] = None,
    new_values: Optional[Dict] = None,
):
    """Логировать действие с картой."""
    log_action(
        action=action,
        target_type="map",
        target_id=map_id,
        target_name=map_name,
        old_values=old_values,
        new_values=new_values,
    )


def log_device_action(
    action: str,
    device_id: int,
    device_name: str,
    map_id: Optional[int] = None,
    old_values: Optional[Dict] = None,
    new_values: Optional[Dict] = None,
):
    """Логировать действие с устройством."""
    log_action(
        action=action,
        target_type="device",
        target_id=device_id,
        target_name=device_name,
        old_values=old_values,
        new_values=new_values,
    )


def log_permission_action(
    action: str,
    map_id: int,
    map_name: str,
    user_id: Optional[int] = None,
    role: Optional[str] = None,
    old_values: Optional[Dict] = None,
    new_values: Optional[Dict] = None,
):
    """Логировать действие с правами доступа."""
    target_name = f"Map {map_id} permission"
    if user_id:
        target_name += f" for user {user_id}"
    if role:
        target_name += f" role={role}"

    log_action(
        action=action,
        target_type="permission",
        target_id=map_id,
        target_name=target_name,
        old_values=old_values,
        new_values=new_values,
    )


def log_auth_action(
    action: str,
    user_id: int,
    username: str,
    ip_address: Optional[str] = None,
):
    """Логировать действие аутентификации."""
    log_action(
        action=action,
        target_type="auth",
        target_id=user_id,
        target_name=username,
        user_id=user_id,
        username=username,
    )


# ============================================================================
# Функции для получения логов
# ============================================================================


def get_audit_logs(
    user_id: Optional[int] = None,
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    action: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    page: int = 1,
    per_page: int = 50,
) -> Dict[str, Any]:
    """
    Получить журнал аудита с фильтрацией.

    Args:
        user_id: Фильтр по пользователю
        target_type: Фильтр по типу объекта
        target_id: Фильтр по ID объекта
        action: Фильтр по действию
        date_from: Начальная дата
        date_to: Конечная дата
        page: Номер страницы
        per_page: Записей на страницу

    Returns:
        Dict с записями и пагинацией
    """
    query = AuditLog.query

    if user_id:
        query = query.filter_by(user_id=user_id)

    if target_type:
        query = query.filter_by(target_type=target_type)

    if target_id:
        query = query.filter_by(target_id=target_id)

    if action:
        query = query.filter_by(action=action)

    if date_from:
        query = query.filter(AuditLog.timestamp >= date_from)

    if date_to:
        query = query.filter(AuditLog.timestamp <= date_to)

    # Сортировка по убыванию даты
    query = query.order_by(AuditLog.timestamp.desc())

    # Пагинация
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    logs = []
    for log in pagination.items:
        logs.append(
            {
                "id": log.id,
                "user_id": log.user_id,
                "username": log.username,
                "action": log.action,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "target_name": log.target_name,
                "old_values": log.old_values,
                "new_values": log.new_values,
                "ip_address": log.ip_address,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            }
        )

    return {
        "logs": logs,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "total": pagination.total,
        "pages": pagination.pages,
        "has_next": pagination.has_next,
        "has_prev": pagination.has_prev,
    }


def get_user_activity_summary(user_id: int, days: int = 7) -> Dict[str, Any]:
    """
    Получить сводку активности пользователя за период.

    Args:
        user_id: ID пользователя
        days: Количество дней

    Returns:
        Dict со статистикой
    """
    date_from = datetime.now() - timedelta(days=days)

    # Общее количество действий
    total_actions = AuditLog.query.filter(
        AuditLog.user_id == user_id,
        AuditLog.timestamp >= date_from,
    ).count()

    # Действия по типам
    actions_by_type = (
        db.session.query(AuditLog.target_type, func.count(AuditLog.id).label("count"))
        .filter(
            AuditLog.user_id == user_id,
            AuditLog.timestamp >= date_from,
        )
        .group_by(AuditLog.target_type)
        .all()
    )

    # Последние действия
    recent_logs = (
        AuditLog.query.filter(
            AuditLog.user_id == user_id,
            AuditLog.timestamp >= date_from,
        )
        .order_by(AuditLog.timestamp.desc())
        .limit(10)
        .all()
    )

    return {
        "user_id": user_id,
        "period_days": days,
        "total_actions": total_actions,
        "actions_by_type": {row[0]: row[1] for row in actions_by_type},
        "recent_actions": [
            {
                "action": log.action,
                "target_type": log.target_type,
                "target_name": log.target_name,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            }
            for log in recent_logs
        ],
    }
