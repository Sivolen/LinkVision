"""
API роуты для папок карт (MapFolder) — дерево сайдбара и права на группы карт.
"""

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from models import Map, MapFolder, FolderPermission, User, db
from services import (
    map_service,
    folder_service,
    require_folder_owner_or_admin,
    log_action,
)
from services.permissions import can_delete_map, _get_user_folder_role
from utils.logger import api_logger

folders_bp = Blueprint("folders", __name__)


@folders_bp.route("/sidebar-tree", methods=["GET"])
@login_required
def get_sidebar_tree():
    """Дерево папок/карт для сайдбара, отфильтрованное по видимости для текущего пользователя."""
    data = map_service.get_sidebar_tree_data(current_user)
    return jsonify(data)


def _can_reorder_in_folder(folder_id) -> bool:
    """
    Право переставлять порядок элементов НА ДАННОМ уровне дерева.

    folder_id=None (корень) — своих прав достаточно: корень у каждого
    пользователя свой набор видимых элементов (см. get_sidebar_tree_data),
    поэтому там нечего защищать сверх обычной видимости.

    Для содержимого папки — та же планка, что и на перенос карты В эту папку:
    владелец папки, глобальный админ, либо editor/admin через FolderPermission
    (свой или унаследованный от родительских папок).
    """
    if folder_id is None:
        return True
    if current_user.is_admin:
        return True
    folder = db.session.get(MapFolder, folder_id)
    if not folder:
        return False
    if folder.owner_id == current_user.id:
        return True
    return _get_user_folder_role(folder_id) in ("editor", "admin")


@folders_bp.route("/sidebar/reorder", methods=["PUT"])
@login_required
def reorder_sidebar():
    """
    Сохранить новый порядок элементов ОДНОГО уровня дерева (drag-and-drop).

    Body: {"parent_folder_id": int | null, "items": [{"type": "map"|"folder", "id": int}, ...]}
    Индекс элемента в массиве items становится его новым position.

    Папки и карты — вперемешку в одном массиве: так карту можно поставить
    выше папки на том же уровне (и наоборот), см. get_sidebar_tree_data.

    Защита от чужого уровня: элемент из items, чей реальный folder_id/parent_id
    не совпадает с заявленным parent_folder_id, молча пропускается — этот
    роут только переставляет порядок, а не переносит элементы между папками
    (для переноса — PUT /api/map/<id>/folder и PUT /api/folder/<id>).
    """
    data = request.json or {}
    parent_folder_id = data.get("parent_folder_id")
    items = data.get("items", [])

    if not isinstance(items, list):
        return jsonify({"error": "items должен быть списком"}), 400

    if not _can_reorder_in_folder(parent_folder_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    for index, item in enumerate(items):
        item_type = item.get("type")
        item_id = item.get("id")

        if item_type == "map":
            m = db.session.get(Map, item_id)
            if m and m.folder_id == parent_folder_id:
                m.position = index
        elif item_type == "folder":
            f = db.session.get(MapFolder, item_id)
            if f and f.parent_id == parent_folder_id:
                f.position = index

    db.session.commit()
    map_service.invalidate_all_sidebar_caches()
    return jsonify({"status": "ok"})


@folders_bp.route("/folder", methods=["POST"])
@login_required
def create_folder():
    """
    Создать папку.

    Body: {"name": str, "parent_id": int | null}

    Создавать папки может любой авторизованный пользователь (как и карты) —
    владельцем становится создатель, дальше он же управляет ею через
    require_folder_owner_or_admin. Если задан parent_id — создающий должен
    иметь доступ на РЕДАКТИРОВАНИЕ этой родительской папки (иначе кто угодно
    мог бы захламить чужое дерево подпапками); для папок верхнего уровня
    ограничений нет.
    """
    data = request.json or {}
    name = data.get("name")
    parent_id = data.get("parent_id")

    if not name or not str(name).strip():
        return jsonify({"error": "Название папки обязательно"}), 400

    if parent_id is not None:
        parent = db.session.get(MapFolder, parent_id)
        if not parent:
            return jsonify({"error": "Родительская папка не найдена"}), 404
        is_owner_or_admin = current_user.is_admin or parent.owner_id == current_user.id
        if not is_owner_or_admin and _get_user_folder_role(parent_id) not in (
            "editor",
            "admin",
        ):
            return jsonify({"error": "Нет прав на создание подпапки здесь"}), 403

    try:
        folder = folder_service.create_folder(name, current_user.id, parent_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    log_action(
        action="create_folder",
        target_type="folder",
        target_id=folder.id,
        target_name=folder.name,
        new_values={"name": folder.name, "parent_id": folder.parent_id},
    )

    return (
        jsonify({"id": folder.id, "name": folder.name, "parent_id": folder.parent_id}),
        201,
    )


@folders_bp.route("/folder/<int:folder_id>", methods=["PUT"])
@login_required
@require_folder_owner_or_admin
def update_folder(folder_id):
    """
    Переименовать и/или переместить папку.

    Body: {"name": str?, "parent_id": int | null (передавать явно, чтобы
           переместить в корень)}
    """
    folder = db.session.get(MapFolder, folder_id)
    if not folder:
        return jsonify({"error": "Папка не найдена"}), 404

    data = request.json or {}
    old_values = {"name": folder.name, "parent_id": folder.parent_id}

    try:
        if "name" in data:
            folder_service.rename_folder(folder_id, data["name"])
        if "parent_id" in data:
            folder_service.move_folder(folder_id, data["parent_id"])
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    db.session.refresh(folder)

    log_action(
        action="update_folder",
        target_type="folder",
        target_id=folder.id,
        target_name=folder.name,
        old_values=old_values,
        new_values={"name": folder.name, "parent_id": folder.parent_id},
    )

    return jsonify(
        {"id": folder.id, "name": folder.name, "parent_id": folder.parent_id}
    )


@folders_bp.route("/folder/<int:folder_id>", methods=["DELETE"])
@login_required
@require_folder_owner_or_admin
def delete_folder(folder_id):
    """
    Удалить папку.

    Query-параметр ?cascade=true — удалить непустую папку (подпапки удаляются
    рекурсивно как узлы дерева, карты внутри переносятся в корень, а не
    удаляются). Без него непустая папка вернёт 409.
    """
    folder = db.session.get(MapFolder, folder_id)
    if not folder:
        return jsonify({"error": "Папка не найдена"}), 404

    cascade = request.args.get("cascade", "false").lower() == "true"
    folder_name = folder.name

    try:
        folder_service.delete_folder(folder_id, cascade=cascade)
    except ValueError as e:
        return jsonify({"error": str(e)}), 409

    log_action(
        action="delete_folder",
        target_type="folder",
        target_id=folder_id,
        target_name=folder_name,
        old_values={"cascade": cascade},
    )

    return jsonify({"status": "deleted", "id": folder_id})


@folders_bp.route("/map/<int:map_id>/folder", methods=["PUT"])
@login_required
def move_map_to_folder(map_id):
    """
    Переместить карту в папку (или в корень, если folder_id=null).

    Право на это действие — то же самое, что право переименовать/удалить
    карту: владелец карты или глобальный админ. Права на ЦЕЛЕВУЮ папку
    отдельно не требуются — перемещение карты в папку не выдаёт вам права на
    остальное содержимое папки и не отбирает их у тех, кому они уже даны.
    """
    if not can_delete_map(map_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    map_obj = db.session.get(Map, map_id)
    if not map_obj:
        return jsonify({"error": "Карта не найдена"}), 404

    data = request.json or {}
    folder_id = data.get("folder_id")

    old_folder_id = map_obj.folder_id

    try:
        folder_service.move_map_to_folder(map_id, folder_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    log_action(
        action="move_map",
        target_type="map",
        target_id=map_id,
        target_name=map_obj.name,
        old_values={"folder_id": old_folder_id},
        new_values={"folder_id": folder_id},
    )

    return jsonify({"id": map_id, "folder_id": folder_id})


# ─── Права на папку ─────────────────────────────────────────────────────────


@folders_bp.route("/folder/<int:folder_id>/permissions", methods=["GET"])
@login_required
@require_folder_owner_or_admin
def get_folder_permissions(folder_id):
    permissions = FolderPermission.query.filter_by(folder_id=folder_id).all()

    result = []
    for perm in permissions:
        perm_data = {
            "id": perm.id,
            "folder_id": perm.folder_id,
            "type": "user" if perm.user_id else "role",
            "role": perm.role,
        }
        if perm.user_id:
            user = db.session.get(User, perm.user_id)
            perm_data["user_id"] = user.id
            perm_data["username"] = user.username if user else "Unknown"
        result.append(perm_data)

    return jsonify(result)


@folders_bp.route("/folder/<int:folder_id>/permissions", methods=["POST"])
@login_required
@require_folder_owner_or_admin
def add_folder_permission(folder_id):
    """
    Body:
    - user_id: ID пользователя (опционально, если задан role без user_id — ролевое разрешение)
    - role: 'viewer', 'editor', 'admin' (обязательно)
    """
    folder = db.session.get(MapFolder, folder_id)
    if not folder:
        return jsonify({"error": "Папка не найдена"}), 404

    data = request.json or {}
    user_id = data.get("user_id")
    role = data.get("role")

    if not role or role not in ["viewer", "editor", "admin"]:
        return (
            jsonify({"error": "Invalid role. Must be 'viewer', 'editor', or 'admin'"}),
            400,
        )

    try:
        if user_id:
            user = db.session.get(User, user_id)
            if not user:
                return jsonify({"error": "User not found"}), 404
            perm = folder_service.grant_folder_permission(folder_id, user_id, role)
            username = user.username
        else:
            if role == "admin":
                return (
                    jsonify({"error": "Ролевое разрешение admin не поддерживается"}),
                    400,
                )
            perm = folder_service.grant_folder_role_permission(folder_id, role)
            username = None
    except ValueError as e:
        return jsonify({"error": str(e)}), 409

    log_action(
        action="add_folder_permission",
        target_type="folder",
        target_id=folder_id,
        target_name=folder.name,
        new_values={"user_id": user_id, "role": role},
    )

    return (
        jsonify(
            {
                "id": perm.id,
                "folder_id": folder_id,
                "user_id": user_id,
                "username": username,
                "role": role,
            }
        ),
        201,
    )


@folders_bp.route("/folder/<int:folder_id>/permissions/<int:perm_id>", methods=["PUT"])
@login_required
@require_folder_owner_or_admin
def update_folder_permission(folder_id, perm_id):
    folder = db.session.get(MapFolder, folder_id)
    if not folder:
        return jsonify({"error": "Папка не найдена"}), 404

    perm = FolderPermission.query.get_or_404(perm_id)
    if perm.folder_id != folder_id:
        return jsonify({"error": "Permission not found for this folder"}), 404

    data = request.json or {}
    role = data.get("role")
    if not role or role not in ["viewer", "editor", "admin"]:
        return jsonify({"error": "Invalid role"}), 400

    old_role = perm.role
    perm = folder_service.update_folder_permission_role(perm_id, role)

    log_action(
        action="update_folder_permission",
        target_type="folder",
        target_id=folder_id,
        target_name=folder.name,
        user_id=perm.user_id,
        old_values={"role": old_role},
        new_values={"role": role},
    )

    return jsonify(
        {
            "id": perm.id,
            "folder_id": folder_id,
            "user_id": perm.user_id,
            "role": perm.role,
        }
    )


@folders_bp.route(
    "/folder/<int:folder_id>/permissions/<int:perm_id>", methods=["DELETE"]
)
@login_required
@require_folder_owner_or_admin
def delete_folder_permission(folder_id, perm_id):
    folder = db.session.get(MapFolder, folder_id)
    if not folder:
        return jsonify({"error": "Папка не найдена"}), 404

    perm = FolderPermission.query.get_or_404(perm_id)
    if perm.folder_id != folder_id:
        return jsonify({"error": "Permission not found for this folder"}), 404

    perm_user_id = perm.user_id
    perm_role = perm.role
    folder_service.revoke_folder_permission(perm_id)

    log_action(
        action="delete_folder_permission",
        target_type="folder",
        target_id=folder_id,
        target_name=folder.name,
        user_id=perm_user_id,
        old_values={"user_id": perm_user_id, "role": perm_role},
    )

    return jsonify({"status": "deleted", "id": perm_id})
