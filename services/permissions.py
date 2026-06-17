"""
Модуль проверок прав доступа v2.0.

Содержит функции и декораторы для проверки прав пользователя:
- Доступ к картам (просмотр/редактирование/удаление)
- Доступ к устройствам
- Роли пользователей (admin, operator, user)
- Гранулярные разрешения через MapPermission
"""

from functools import wraps
from typing import Optional, Callable, Any
from flask import jsonify
from flask_login import current_user
from models import Map, Device, MapPermission


def _get_user_map_permission(map_id: int) -> Optional[MapPermission]:
    """
    Получить явное разрешение пользователя на карту (1 запрос).

    Args:
        map_id: ID карты

    Returns:
        MapPermission или None
    """
    # Один запрос с OR условием: персональное ИЛИ ролевое для операторов
    if current_user.is_operator:
        perm = MapPermission.query.filter(
            MapPermission.map_id == map_id,
            (
                (MapPermission.user_id == current_user.id)
                | (MapPermission.role.in_(["viewer", "editor"]))
            ),
        ).first()
    else:
        perm = MapPermission.query.filter_by(
            map_id=map_id, user_id=current_user.id
        ).first()

    return perm

    # Если пользователь оператор — ищем разрешение для роли
    if current_user.is_operator:
        perm = MapPermission.query.filter_by(map_id=map_id, role="editor").first()
        if perm:
            return perm
        perm = MapPermission.query.filter_by(map_id=map_id, role="viewer").first()
        if perm:
            return perm

    return None


def can_view_map(map_id: int) -> bool:
    """
    Проверить право просмотра карты.

    Логика проверки:
    1. Администратор — всегда может
    2. Оператор — всегда может (но редактировать только с разрешением)
    3. Владелец карты — всегда может
    4. Явное разрешение (viewer/editor/admin) — может
    5. Иначе — запрещено

    Args:
        map_id: ID карты

    Returns:
        bool: True если доступ разрешён
    """
    if not current_user.is_authenticated:
        return False

    # Администратор видит всё
    if current_user.is_admin:
        return True

    # Оператор видит все карты
    if current_user.is_operator:
        return True

    # Владелец карты всегда видит свою карту
    map_obj = Map.query.get(map_id)
    if map_obj and map_obj.owner_id == current_user.id:
        return True

    # Проверяем явные разрешения
    perm = _get_user_map_permission(map_id)
    if perm and perm.role in ["viewer", "editor", "admin"]:
        return True

    return False


def can_edit_map(map_id: int) -> bool:
    """
    Проверить право редактирования карты.

    Логика проверки:
    1. Администратор — всегда может
    2. Владелец карты — всегда может (если не заблокирована)
    3. Карта заблокирована — нельзя (кроме админа)
    4. Оператор с разрешением editor — может
    5. Пользователь с разрешением editor/admin — может
    6. Иначе — запрещено

    Args:
        map_id: ID карты

    Returns:
        bool: True если пользователь может редактировать
    """
    if not current_user.is_authenticated:
        return False

    # Администратор может всё
    if current_user.is_admin:
        return True

    map_obj = Map.query.get(map_id)
    if not map_obj:
        return False

    # Владелец карты может редактировать (если не заблокирована)
    if map_obj.owner_id == current_user.id:
        return not map_obj.is_locked

    # Проверяем карту на блокировку
    if map_obj.is_locked:
        return False

    # Оператор может редактировать только с разрешением editor
    if current_user.is_operator:
        perm = MapPermission.query.filter_by(map_id=map_id, role="editor").first()
        if perm:
            return True
        return False

    # Проверяем явные разрешения для обычных пользователей
    perm = _get_user_map_permission(map_id)
    if perm and perm.role in ["editor", "admin"]:
        return True

    return False


def can_delete_map(map_id: int) -> bool:
    """
    Проверить право удаления карты.

    Логика проверки:
    1. Администратор — всегда может
    2. Владелец карты — может
    3. Иначе — запрещено

    Args:
        map_id: ID карты

    Returns:
        bool: True если пользователь может удалить
    """
    if not current_user.is_authenticated:
        return False

    # Администратор может удалить любую карту
    if current_user.is_admin:
        return True

    # Владелец может удалить свою карту
    map_obj = Map.query.get(map_id)
    return map_obj is not None and map_obj.owner_id == current_user.id


def has_map_access(map_id: int) -> bool:
    """
    Проверить доступ текущего пользователя к карте (для просмотра).
    Алиас для can_view_map для обратной совместимости.

    Args:
        map_id: ID карты

    Returns:
        bool: True если доступ разрешён
    """
    return can_view_map(map_id)


def has_device_access(device_id: int) -> bool:
    """
    Проверить доступ текущего пользователя к устройству.
    Доступ к устройству есть, если есть доступ к его карте.

    Args:
        device_id: ID устройства

    Returns:
        bool: True если доступ разрешён
    """
    device = Device.query.get(device_id)
    if not device:
        return False

    return can_view_map(device.map_id)


def can_edit_device(device_id: int) -> bool:
    """
    Проверить право редактирования устройства.
    Зависит от права редактирования карты.

    Args:
        device_id: ID устройства

    Returns:
        bool: True если пользователь может редактировать
    """
    device = Device.query.get(device_id)
    if not device:
        return False

    return can_edit_map(device.map_id)


def require_map_access(f: Callable) -> Callable:
    """
    Декоратор для проверки доступа к карте (просмотр).

    Usage:
        @api_bp.route("/map/<int:map_id>")
        @require_map_access
        def get_map(map_id):
            ...
    """

    @wraps(f)
    def decorated_function(map_id: int, *args: Any, **kwargs: Any) -> Any:
        if not can_view_map(map_id):
            return jsonify({"error": "Доступ запрещён"}), 403
        return f(map_id, *args, **kwargs)

    return decorated_function


def require_map_edit(f: Callable) -> Callable:
    """
    Декоратор для проверки права редактирования карты.

    Usage:
        @api_bp.route("/map/<int:map_id>", methods=["PUT"])
        @require_map_edit
        def update_map(map_id):
            ...
    """

    @wraps(f)
    def decorated_function(map_id: int, *args: Any, **kwargs: Any) -> Any:
        if not can_edit_map(map_id):
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


def require_device_edit(f: Callable) -> Callable:
    """
    Декоратор для проверки права редактирования устройства.

    Usage:
        @api_bp.route("/device/<int:device_id>", methods=["PUT"])
        @require_device_edit
        def update_device(device_id):
            ...
    """

    @wraps(f)
    def decorated_function(device_id: int, *args: Any, **kwargs: Any) -> Any:
        if not can_edit_device(device_id):
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
    Устаревший декоратор, используется для обратной совместимости.

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


def require_map_owner_or_admin(f: Callable) -> Callable:
    """
    Декоратор для проверки: администратор ИЛИ владелец карты.

    Usage:
        @api_bp.route("/map/<int:map_id>/permissions")
        @require_map_owner_or_admin
        def manage_permissions(map_id):
            ...
    """

    @wraps(f)
    def decorated_function(map_id: int, *args: Any, **kwargs: Any) -> Any:
        if not current_user.is_authenticated:
            return jsonify({"error": "Требуется аутентификация"}), 401

        if current_user.is_admin:
            return f(map_id, *args, **kwargs)

        map_obj = Map.query.get(map_id)
        if not map_obj or map_obj.owner_id != current_user.id:
            return jsonify({"error": "Только владелец карты или администратор"}), 403

        return f(map_id, *args, **kwargs)

    return decorated_function


def get_user_map_ids() -> list[int]:
    """
    Получить список ID карт, доступных пользователю для просмотра.

    Returns:
        list[int]: Список ID карт
    """
    if not current_user.is_authenticated:
        return []

    # Администратор видит все карты
    if current_user.is_admin:
        return [m.id for m in Map.query.all()]

    # Оператор видит карты с разрешением viewer/editor + свои
    if current_user.is_operator:
        # Карты с явными разрешениями
        perms = MapPermission.query.filter(
            (
                (MapPermission.user_id == current_user.id)
                | (MapPermission.role.in_(["viewer", "editor"]))
            ),
            MapPermission.map_id.isnot(None),
        ).all()
        perm_map_ids = [p.map_id for p in perms]

        # Свои карты
        own_maps = Map.query.filter_by(owner_id=current_user.id).all()
        own_map_ids = [m.id for m in own_maps]

        return list(set(perm_map_ids + own_map_ids))

    # Обычный пользователь видит свои карты + карты с персональными разрешениями
    own_maps = Map.query.filter_by(owner_id=current_user.id).all()
    own_map_ids = [m.id for m in own_maps]

    perms = MapPermission.query.filter_by(user_id=current_user.id).all()
    perm_map_ids = [p.map_id for p in perms]

    return list(set(own_map_ids + perm_map_ids))


def get_user_editable_map_ids() -> list[int]:
    """
    Получить список ID карт, которые пользователь может редактировать.

    Returns:
        list[int]: Список ID карт
    """
    if not current_user.is_authenticated:
        return []

    # Администратор может редактировать все карты
    if current_user.is_admin:
        return [m.id for m in Map.query.all()]

    # Карты, которые не заблокированы и пользователь имеет права
    editable_ids = []

    # Владелец может редактировать свои незаблокированные карты
    own_maps = Map.query.filter_by(owner_id=current_user.id, is_locked=False).all()
    editable_ids.extend([m.id for m in own_maps])

    # Персональные разрешения editor/admin
    perms = MapPermission.query.filter_by(user_id=current_user.id, role="editor").all()
    for perm in perms:
        map_obj = Map.query.get(perm.map_id)
        if map_obj and not map_obj.is_locked:
            editable_ids.append(perm.map_id)

    # Оператор с ролью editor
    if current_user.is_operator:
        perms = MapPermission.query.filter_by(role="editor").all()
        for perm in perms:
            map_obj = Map.query.get(perm.map_id)
            if map_obj and not map_obj.is_locked:
                editable_ids.append(perm.map_id)

    return list(set(editable_ids))
