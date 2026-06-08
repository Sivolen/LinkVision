"""
Модуль проверок прав доступа.

Содержит функции и декораторы для проверки прав пользователя:
- Доступ к картам
- Доступ к устройствам
- Роли пользователей (admin, operator, user)
"""

from functools import wraps
from typing import Optional, Callable, Any
from flask import jsonify, g
from flask_login import current_user
from models import Map, Device


def has_map_access(map_id: int) -> bool:
    """
    Проверить доступ текущего пользователя к карте.
    
    Args:
        map_id: ID карты
    
    Returns:
        bool: True если доступ разрешён
    """
    if current_user.is_admin or current_user.is_operator:
        return True
    
    map_obj = Map.query.get(map_id)
    return map_obj is not None and map_obj.owner_id == current_user.id


def has_device_access(device_id: int) -> bool:
    """
    Проверить доступ текущего пользователя к устройству.
    
    Args:
        device_id: ID устройства
    
    Returns:
        bool: True если доступ разрешён
    """
    if current_user.is_admin or current_user.is_operator:
        return True
    
    device = Device.query.get(device_id)
    return device is not None and device.map.owner_id == current_user.id


def require_map_access(f: Callable) -> Callable:
    """
    Декоратор для проверки доступа к карте.
    
    Usage:
        @api_bp.route("/map/<int:map_id>")
        @require_map_access
        def get_map(map_id):
            ...
    """
    @wraps(f)
    def decorated_function(map_id: int, *args: Any, **kwargs: Any) -> Any:
        if not has_map_access(map_id):
            return jsonify({"error": "Доступ запрещён"}), 403
        return f(map_id, *args, **kwargs)
    return decorated_function


def require_device_access(f: Callable) -> Callable:
    """
    Декоратор для проверки доступа к устройству.
    
    Usage:
        @api_bp.route("/device/<int:device_id>")
        @require_device_access
        def get_device(device_id):
            ...
    """
    @wraps(f)
    def decorated_function(device_id: int, *args: Any, **kwargs: Any) -> Any:
        if not has_device_access(device_id):
            return jsonify({"error": "Доступ запрещён"}), 403
        return f(device_id, *args, **kwargs)
    return decorated_function


def require_admin(f: Callable) -> Callable:
    """
    Декоратор для проверки прав администратора.
    
    Usage:
        @api_bp.route("/admin/users")
        @require_admin
        def admin_panel():
            ...
    """
    @wraps(f)
    def decorated_function(*args: Any, **kwargs: Any) -> Any:
        if not current_user.is_authenticated or not current_user.is_admin:
            return jsonify({"error": "Требуются права администратора"}), 403
        return f(*args, **kwargs)
    return decorated_function


def require_not_operator(f: Callable) -> Callable:
    """
    Декоратор для запрета оператору.
    
    Usage:
        @api_bp.route("/device", methods=["POST"])
        @require_not_operator
        def create_device():
            ...
    """
    @wraps(f)
    def decorated_function(*args: Any, **kwargs: Any) -> Any:
        if current_user.is_operator:
            return jsonify({"error": "Оператор не может выполнять это действие"}), 403
        return f(*args, **kwargs)
    return decorated_function


def get_user_map_ids() -> list[int]:
    """
    Получить список ID карт, доступных пользователю.
    
    Returns:
        list[int]: Список ID карт
    """
    if not current_user.is_authenticated:
        return []
    
    if current_user.is_admin or current_user.is_operator:
        return [m.id for m in Map.query.all()]
    
    return [m.id for m in Map.query.filter_by(owner_id=current_user.id).all()]


def can_edit_map(map_id: int) -> bool:
    """
    Проверить, может ли пользователь редактировать карту.
    
    Args:
        map_id: ID карты
    
    Returns:
        bool: True если пользователь может редактировать
    """
    if current_user.is_admin:
        return True
    
    if current_user.is_operator:
        return False
    
    map_obj = Map.query.get(map_id)
    return map_obj is not None and map_obj.owner_id == current_user.id


def can_delete_map(map_id: int) -> bool:
    """
    Проверить, может ли пользователь удалить карту.
    
    Args:
        map_id: ID карты
    
    Returns:
        bool: True если пользователь может удалить
    """
    # Только администратор или владелец
    if current_user.is_admin:
        return True
    
    map_obj = Map.query.get(map_id)
    return map_obj is not None and map_obj.owner_id == current_user.id
