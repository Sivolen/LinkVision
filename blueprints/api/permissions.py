"""
API роуты для управления правами доступа (Permissions).
"""

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from models import Map, MapPermission, User, db
from services import (
    require_map_access,
    require_map_owner_or_admin,
    log_permission_action,
    grant_map_permission,
    grant_map_role_permission,
    update_map_permission_role,
    revoke_map_permission,
)
from utils.logger import api_logger

permissions_bp = Blueprint("permissions", __name__)


@permissions_bp.route("/map/<int:map_id>/permissions", methods=["GET"])
@login_required
@require_map_access
@require_map_owner_or_admin
def get_map_permissions(map_id):
    """
    Получить список разрешений для карты.

    Доступно: администраторам, владельцу карты.
    """
    permissions = MapPermission.query.filter_by(map_id=map_id).all()

    result = []
    for perm in permissions:
        perm_data = {
            "id": perm.id,
            "map_id": perm.map_id,
            "type": "user" if perm.user_id else "role",
            "role": perm.role,
        }
        if perm.user_id:
            user = db.session.get(User, perm.user_id)
            perm_data["user_id"] = user.id
            perm_data["username"] = user.username if user else "Unknown"
        result.append(perm_data)

    return jsonify(result)


@permissions_bp.route("/map/<int:map_id>/permissions", methods=["POST"])
@login_required
@require_map_owner_or_admin
def add_map_permission(map_id):
    """
    Добавить разрешение на карту.

    Доступно: администраторам, владельцу карты.

    Body:
    - user_id: ID пользователя (опционально)
    - role: 'viewer', 'editor', 'admin' (обязательно)
    """
    map_obj = Map.query.get_or_404(map_id)

    data = request.json or {}
    user_id = data.get("user_id")
    role = data.get("role")

    if not role or role not in ["viewer", "editor", "admin"]:
        return (
            jsonify({"error": "Invalid role. Must be 'viewer', 'editor', or 'admin'"}),
            400,
        )

    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    # Проверка существования пользователя
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    try:
        # Создаём разрешение через сервис
        perm = grant_map_permission(map_id, user_id, role)

        # Аудит
        log_permission_action(
            action="add_permission",
            map_id=map_id,
            map_name=map_obj.name,
            user_id=user_id,
            role=role,
            new_values={"user_id": user_id, "role": role},
        )

        api_logger.info(
            f"Permission added: map_id={map_id}, user_id={user_id}, role={role}, by={current_user.id}"
        )

        return (
            jsonify(
                {
                    "id": perm.id,
                    "map_id": map_id,
                    "user_id": user_id,
                    "username": user.username,
                    "role": role,
                }
            ),
            201,
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 409


@permissions_bp.route("/map/<int:map_id>/permissions/<int:perm_id>", methods=["PUT"])
@login_required
@require_map_owner_or_admin
def update_map_permission(map_id, perm_id):
    """
    Обновить разрешение на карту.

    Доступно: администраторам, владельцу карты.

    Body:
    - role: 'viewer', 'editor', 'admin'
    """
    map_obj = Map.query.get_or_404(map_id)

    perm = MapPermission.query.get_or_404(perm_id)
    if perm.map_id != map_id:
        return jsonify({"error": "Permission not found for this map"}), 404

    data = request.json or {}
    role = data.get("role")

    old_role = perm.role

    if role and role not in ["viewer", "editor", "admin"]:
        return jsonify({"error": "Invalid role"}), 400

    if role:
        # Обновляем через сервис
        perm = update_map_permission_role(perm_id, role)

        # Аудит
        log_permission_action(
            action="update_permission",
            map_id=map_id,
            map_name=map_obj.name,
            user_id=perm.user_id,
            old_values={"role": old_role},
            new_values={"role": role},
        )

    api_logger.info(
        f"Permission updated: perm_id={perm_id}, role={role}, by={current_user.id}"
    )

    return jsonify(
        {"id": perm.id, "map_id": map_id, "user_id": perm.user_id, "role": perm.role}
    )


@permissions_bp.route("/map/<int:map_id>/permissions/<int:perm_id>", methods=["DELETE"])
@login_required
@require_map_owner_or_admin
def delete_map_permission(map_id, perm_id):
    """
    Удалить разрешение на карту.

    Доступно: администраторам, владельцу карты.
    """
    map_obj = Map.query.get_or_404(map_id)

    perm = MapPermission.query.get_or_404(perm_id)
    if perm.map_id != map_id:
        return jsonify({"error": "Permission not found for this map"}), 404

    # Данные для аудита
    perm_user_id = perm.user_id
    perm_role = perm.role

    # Удаляем через сервис
    revoke_map_permission(perm_id)

    # Аудит
    log_permission_action(
        action="delete_permission",
        map_id=map_id,
        map_name=map_obj.name,
        user_id=perm_user_id,
        role=perm_role,
        old_values={"user_id": perm_user_id, "role": perm_role},
    )

    api_logger.info(f"Permission deleted: perm_id={perm_id}, by={current_user.id}")

    return jsonify({"status": "deleted", "id": perm_id})


@permissions_bp.route("/map/<int:map_id>/permissions/role", methods=["POST"])
@login_required
@require_map_owner_or_admin
def add_map_role_permission(map_id):
    """
    Добавить разрешение для роли (все операторы).

    Доступно: администраторам, владельцу карты.

    Body:
    - role: 'viewer' или 'editor'
    """
    map_obj = Map.query.get_or_404(map_id)

    data = request.json or {}
    role = data.get("role")

    if not role or role not in ["viewer", "editor"]:
        return jsonify({"error": "Invalid role. Must be 'viewer' or 'editor'"}), 400

    try:
        # Создаём разрешение через сервис
        perm = grant_map_role_permission(map_id, role)

        api_logger.info(
            f"Role permission added: map_id={map_id}, role={role}, by={current_user.id}"
        )

        return jsonify({"id": perm.id, "map_id": map_id, "role": role}), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 409
