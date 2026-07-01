"""
API роуты для групп (Groups).
"""

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from services import (
    map_service,
    can_edit_map,
    invalidate_groups_cache,
)
from services.notifications import (
    notify_group_created,
    notify_group_updated,
    notify_group_deleted,
)
from utils.logger import api_logger

groups_bp = Blueprint("groups", __name__)


@groups_bp.route("/group", methods=["POST"])
@login_required
def create_group():
    """Создать группу."""
    data = request.json
    map_id = data.get("map_id")

    if not map_id:
        return jsonify({"error": "map_id required"}), 400

    if not data.get("name"):
        return jsonify({"error": "name required"}), 400

    # Проверка права редактирования карты
    if not can_edit_map(map_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    try:
        # Валидация карты
        map_service.validate_map(map_id)

        font_size = data.get("font_size", 11)
        group = map_service.create_group(
            map_id, data["name"], data.get("color", "#3498db"), font_size
        )

        invalidate_groups_cache(map_id)
        group_data = {
            "id": group.id,
            "name": group.name,
            "color": group.color,
            "font_size": group.font_size,
        }
        notify_group_created(map_id, group_data)
        return jsonify({"id": group.id}), 201

    except ValueError as e:
        api_logger.warning(f"Validation error creating group: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception:
        api_logger.exception("Error creating group")
        return jsonify({"error": "Internal server error"}), 500


@groups_bp.route("/group/<int:group_id>", methods=["PUT"])
@login_required
def update_group(group_id):
    """Обновить группу."""
    group = map_service.get_group_by_id(group_id)
    if not group:
        return jsonify({"error": "Group not found"}), 404

    # Проверка права редактирования карты
    if not can_edit_map(group.map_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    data = request.json
    try:
        # Валидация названия
        name = data.get("name")
        if name is not None and (not name or len(name) < 2):
            return jsonify({"error": "Group name must be at least 2 characters"}), 400

        # Сохраняем map_id до обновления
        map_id = group.map_id

        map_service.update_group(
            group_id,
            name=data.get("name"),
            color=data.get("color"),
            font_size=data.get("font_size"),
        )

        invalidate_groups_cache(map_id)
        group_data = {
            "id": group_id,
            "name": data.get("name"),
            "color": data.get("color"),
            "font_size": data.get("font_size"),
        }
        notify_group_updated(map_id, group_data)
        return jsonify({"status": "updated"})

    except ValueError as e:
        api_logger.warning(f"Validation error updating group {group_id}: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception:
        api_logger.exception("Error updating group")
        return jsonify({"error": "Internal server error"}), 500


@groups_bp.route("/group/<int:group_id>", methods=["DELETE"])
@login_required
def delete_group(group_id):
    """Удалить группу."""
    group = map_service.get_group_by_id(group_id)
    if not group:
        return jsonify({"error": "Group not found"}), 404

    # Проверка права редактирования карты
    if not can_edit_map(group.map_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    # Сохраняем map_id до удаления
    map_id = group.map_id

    try:
        map_service.delete_group(group_id)
        invalidate_groups_cache(map_id)
        notify_group_deleted(map_id, group_id)
        return jsonify({"status": "deleted"})
    except Exception:
        api_logger.exception("Error deleting group")
        return jsonify({"error": "Internal server error"}), 500
