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
from models import Map, Device, MapPermission, MapFolder, FolderPermission, db


def _get_user_map_permission(map_id: int) -> Optional[MapPermission]:
    """
    Получить эффективное разрешение текущего пользователя на карту.

    Приоритет: персональное разрешение пользователя, затем ролевое
    разрешение viewer/editor для операторов. Ролевые разрешения хранятся
    с user_id=NULL и никогда не должны подхватывать permission другого
    пользователя.
    """
    perm = MapPermission.query.filter_by(
        map_id=map_id,
        user_id=current_user.id,
    ).first()
    if perm:
        return perm

    if current_user.is_operator:
        return MapPermission.query.filter(
            MapPermission.map_id == map_id,
            MapPermission.user_id.is_(None),
            MapPermission.role.in_(["viewer", "editor"]),
        ).first()

    return None


def _get_folder_chain_ids(folder_id: int) -> list:
    """
    Вернуть [folder_id, ..., id_корневой_папки] — путь от папки до корня.

    Защищено от случайного цикла в parent_id (не должен возникать через
    обычный API, но лучше не уйти в бесконечный цикл, если данные всё же
    испортятся) через seen-множество.
    """
    chain = []
    seen = set()
    current_id = folder_id
    while current_id is not None and current_id not in seen:
        seen.add(current_id)
        chain.append(current_id)
        folder = db.session.get(MapFolder, current_id)
        if not folder:
            break
        current_id = folder.parent_id
    return chain


_FOLDER_ROLE_WEIGHT = {"viewer": 1, "editor": 2, "admin": 3}


def _get_user_folder_role(folder_id: Optional[int]) -> Optional[str]:
    """
    Эффективная роль текущего пользователя на папку карт, С УЧЁТОМ
    наследования от родительских папок — разрешение, выданное на папку,
    действует на все карты внутри неё и во всех вложенных подпапках.

    Если пользователю выдана разная роль на разных уровнях цепочки (например,
    editor на самой папке и admin на родительской), берём МАКСИМАЛЬНО широкую
    роль по всей цепочке, а не ближайшую по дереву — иначе более широкий
    доступ, явно выданный выше по дереву, неожиданно перекрывался бы более
    узкой персональной записью на дочерней папке.
    """
    if folder_id is None:
        return None

    best_role = None
    for fid in _get_folder_chain_ids(folder_id):
        perm = FolderPermission.query.filter_by(
            folder_id=fid, user_id=current_user.id
        ).first()
        if not perm and current_user.is_operator:
            perm = FolderPermission.query.filter(
                FolderPermission.folder_id == fid,
                FolderPermission.user_id.is_(None),
                FolderPermission.role.in_(["viewer", "editor"]),
            ).first()
        if perm and perm.role in _FOLDER_ROLE_WEIGHT:
            if (
                best_role is None
                or _FOLDER_ROLE_WEIGHT[perm.role] > _FOLDER_ROLE_WEIGHT[best_role]
            ):
                best_role = perm.role
    return best_role


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
    map_obj = db.session.get(Map, map_id)
    if map_obj and map_obj.owner_id == current_user.id:
        return True

    # Проверяем явные разрешения на саму карту
    perm = _get_user_map_permission(map_id)
    if perm and perm.role in ["viewer", "editor", "admin"]:
        return True

    # Разрешение, унаследованное от папки (и её родительских папок)
    if map_obj and _get_user_folder_role(map_obj.folder_id):
        return True

    return False


def can_toggle_map_lock(map_id: int) -> bool:
    """
    Проверить право блокировать/разблокировать карту.

    Lock/unlock является отдельной операцией. Право не зависит от
    текущего состояния is_locked, иначе пользователь, заблокировавший
    карту, может потерять возможность её разблокировать.
    """
    if not current_user.is_authenticated:
        return False

    if current_user.is_admin:
        return True

    map_obj = db.session.get(Map, map_id)
    if not map_obj:
        return False

    if map_obj.owner_id == current_user.id:
        return True

    perm = _get_user_map_permission(map_id)
    if perm and perm.role in ["admin", "editor"]:
        return True

    # Папка с ролью editor/admin (унаследованной в т.ч. от родительских папок)
    # тоже даёт право переключать замок — по той же логике, что и персональное
    # разрешение на саму карту.
    folder_role = _get_user_folder_role(map_obj.folder_id)
    return folder_role in ("admin", "editor")


def can_edit_map(map_id: int) -> bool:
    """Проверить право редактирования карты по единой модели доступа."""
    if not current_user.is_authenticated:
        return False

    # Глобальный администратор имеет полный доступ.
    if current_user.is_admin:
        return True

    map_obj = db.session.get(Map, map_id)
    if not map_obj:
        return False

    # Владелец может редактировать незаблокированную карту.
    if map_obj.owner_id == current_user.id:
        return not map_obj.is_locked

    perm = _get_user_map_permission(map_id)
    folder_role = _get_user_folder_role(map_obj.folder_id)

    # Map admin (личный или унаследованный от папки) — полный контроль именно
    # этой карты, включая работу при заблокированной карте.
    if (perm and perm.role == "admin") or folder_role == "admin":
        return True

    # Editor не может обходить блокировку — ни личный, ни через папку.
    if map_obj.is_locked:
        return False

    return bool((perm and perm.role == "editor") or folder_role == "editor")


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
    map_obj = db.session.get(Map, map_id)
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
    device = db.session.get(Device, device_id)
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
    device = db.session.get(Device, device_id)
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


def require_map_lock(f: Callable) -> Callable:
    """
    Проверка права блокировать/разблокировать карту.
    Отдельно от права редактирования содержимого карты.
    """

    @wraps(f)
    def decorated_function(map_id: int, *args: Any, **kwargs: Any) -> Any:
        if not can_toggle_map_lock(map_id):
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

        map_obj = db.session.get(Map, map_id)
        if not map_obj or map_obj.owner_id != current_user.id:
            return jsonify({"error": "Только владелец карты или администратор"}), 403

        return f(map_id, *args, **kwargs)

    return decorated_function


def require_folder_owner_or_admin(f: Callable) -> Callable:
    """
    Декоратор для проверки: администратор ИЛИ владелец папки.

    По аналогии с require_map_owner_or_admin — управлять папкой (переименование,
    перемещение, удаление, выдача прав на неё) может либо глобальный админ,
    либо тот, кто её создал. В отличие от прав НА КАРТУ, "map admin" на
    родительскую папку здесь намеренно не даёт права управлять самой папкой
    (переименовать/удалить/выдавать права) — folder-admin даёт полный доступ
    К СОДЕРЖИМОМУ (картам), но не к структуре дерева папок; это разграничение
    осознанное, чтобы человек с правами редактирования карт внутри чужой
    папки не мог случайно удалить или переименовать саму папку.

    Usage:
        @folders_bp.route("/folder/<int:folder_id>", methods=["PUT"])
        @require_folder_owner_or_admin
        def rename_folder_route(folder_id):
            ...
    """

    @wraps(f)
    def decorated_function(folder_id: int, *args: Any, **kwargs: Any) -> Any:
        if not current_user.is_authenticated:
            return jsonify({"error": "Требуется аутентификация"}), 401

        if current_user.is_admin:
            return f(folder_id, *args, **kwargs)

        folder = db.session.get(MapFolder, folder_id)
        if not folder or folder.owner_id != current_user.id:
            return jsonify({"error": "Только владелец папки или администратор"}), 403

        return f(folder_id, *args, **kwargs)

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

    # Оператор видит все карты. Это соответствует can_view_map() и
    # MapRepository.get_available_for_user(). Редактирование при этом
    # по-прежнему определяется только can_edit_map().
    if current_user.is_operator:
        return [m.id for m in Map.query.all()]

    # Обычный пользователь видит свои карты + карты с персональными разрешениями
    own_maps = Map.query.filter_by(owner_id=current_user.id).all()
    own_map_ids = [m.id for m in own_maps]

    perms = MapPermission.query.filter_by(user_id=current_user.id).all()
    perm_map_ids = [p.map_id for p in perms]

    return list(set(own_map_ids + perm_map_ids))


def get_user_editable_map_ids() -> list[int]:
    """Получить ID карт, которые текущий пользователь может редактировать."""
    if not current_user.is_authenticated:
        return []

    if current_user.is_admin:
        return [m.id for m in Map.query.all()]

    editable_ids = set()

    # Владелец — только незаблокированные карты.
    own_maps = Map.query.filter_by(owner_id=current_user.id, is_locked=False).all()
    editable_ids.update(m.id for m in own_maps)

    # Персональный editor — только незаблокированные карты.
    perms = MapPermission.query.filter_by(user_id=current_user.id, role="editor").all()
    for perm in perms:
        map_obj = db.session.get(Map, perm.map_id)
        if map_obj and not map_obj.is_locked:
            editable_ids.add(perm.map_id)

    # Персональный admin имеет полный контроль, включая locked.
    admin_perms = MapPermission.query.filter_by(
        user_id=current_user.id, role="admin"
    ).all()
    editable_ids.update(perm.map_id for perm in admin_perms)

    # Ролевой editor для всех операторов. Только user_id=NULL.
    if current_user.is_operator:
        perms = MapPermission.query.filter(
            MapPermission.map_id.isnot(None),
            MapPermission.user_id.is_(None),
            MapPermission.role == "editor",
        ).all()
        for perm in perms:
            map_obj = db.session.get(Map, perm.map_id)
            if map_obj and not map_obj.is_locked:
                editable_ids.add(perm.map_id)

    return list(editable_ids)
