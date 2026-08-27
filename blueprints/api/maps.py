"""
API роуты для карт (Maps).
"""

import os
from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required, current_user
from models import Map

from services import (
    map_service,
    require_map_access,
    require_map_edit,
    require_map_lock,
    require_not_operator,
    log_map_action,
    get_cached_types,
    toggle_map_lock as toggle_map_lock_service,
)
from services.permissions import can_edit_map, can_toggle_map_lock

from services.notifications import notify_map_updated, notify_map_lock
from utils.file_validation import safe_save_upload
from utils.logger import api_logger

maps_bp = Blueprint("maps", __name__)


# ============================================================================
# GET-запросы
# ============================================================================


@maps_bp.route("/maps")
@login_required
def get_maps():
    """Получить список доступных карт."""
    maps = map_service.get_available_maps(current_user)
    return jsonify([{"id": m.id, "name": m.name} for m in maps])


@maps_bp.route("/map/<int:map_id>/elements")
@login_required
@require_map_access
def get_elements(map_id):
    """Получить все элементы карты."""
    try:
        elements = map_service.get_map_elements(map_id)
        return jsonify(elements)
    except Exception as e:
        api_logger.error(f"Error fetching map elements: {e}")
        return jsonify({"error": "Internal server error"}), 500


@maps_bp.route("/map/<int:map_id>/groups", methods=["GET"])
@login_required
@require_map_access
def get_groups(map_id):
    """Получить группы карты."""
    try:
        api_logger.info(
            f"get_groups called for map_id={map_id}, user={current_user.id}"
        )
        groups = map_service.get_map_groups(map_id)
        api_logger.info(f"Returning {len(groups)} groups: {groups}")
        return jsonify(groups)
    except Exception as e:
        api_logger.error(f"Error fetching groups: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@maps_bp.route("/types")
@login_required
def get_types():
    """Получить типы устройств."""
    return jsonify(get_cached_types())


@maps_bp.route("/map/<int:map_id>/export", methods=["GET"])
@login_required
@require_map_access
def export_map(map_id):
    """Экспортировать карту в JSON."""
    try:
        data = map_service.export_map_data(map_id)
        return jsonify(data)
    except Exception as e:
        api_logger.error(f"Error exporting map: {e}")
        return jsonify({"error": "Internal server error"}), 500


# ============================================================================
# POST, PUT – изменение данных
# ============================================================================


@maps_bp.route("/map/import", methods=["POST"])
@login_required
@require_not_operator
def import_map_route():
    """Импортировать карту из JSON."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # Если импорт затрагивает существующую карту — проверяем право редактирования
    map_id = data.get("id")
    if map_id and not can_edit_map(map_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    try:
        map_obj = map_service.import_map(data, current_user)
        notify_map_updated(map_obj.id)
        return jsonify({"id": map_obj.id, "status": "imported"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception:
        api_logger.exception("Error importing map")
        return jsonify({"error": "Internal server error"}), 500


@maps_bp.route("/map/<int:map_id>", methods=["PUT"])
@login_required
@require_map_edit
def update_map(map_id):
    """Обновить название и фон карты."""
    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({"error": "Map not found"}), 404

    data = request.form
    name = data.get("name")
    background_filename = None
    remove_background = data.get("remove_background") == "true"

    # Обработка загрузки нового фона
    if "background" in request.files:
        file = request.files["background"]
        if file and file.filename:
            upload_folder = os.path.join(
                current_app.root_path, "static", "uploads", "maps"
            )
            os.makedirs(upload_folder, exist_ok=True)
            saved_name = safe_save_upload(file, upload_folder, prefix=f"map_{map_id}_")
            if saved_name:
                background_filename = saved_name
                # Удаляем старый фон
                if map_obj.background_image:
                    old_path = os.path.join(upload_folder, map_obj.background_image)
                    if os.path.exists(old_path):
                        os.remove(old_path)
            else:
                return jsonify({"error": "Недопустимый файл"}), 400

    try:
        map_service.update_map_details(
            map_id,
            name=name,
            background_filename=background_filename,
            remove_background=remove_background,
        )
        map_service.invalidate_sidebar_cache(map_obj.owner_id)
        notify_map_updated(map_obj.id)
        return jsonify(
            {
                "id": map_obj.id,
                "name": map_obj.name,
                "background": map_obj.background_image,
            }
        )
    except Exception:
        api_logger.exception("Error updating map")
        return jsonify({"error": "Internal server error"}), 500


@maps_bp.route("/map/<int:map_id>/viewport", methods=["PUT"])
@login_required
@require_map_access
def update_viewport(map_id):
    """Обновить настройки viewport пользователя."""
    data = request.json or {}
    pan_x = data.get("pan_x", 0)
    pan_y = data.get("pan_y", 0)
    zoom = data.get("zoom", 1)

    api_logger.info(
        f"Received viewport update: user={current_user.id}, map={map_id}, pan=({pan_x}, {pan_y}), zoom={zoom}"
    )

    try:
        map_service.update_user_viewport(current_user.id, map_id, pan_x, pan_y, zoom)
        return jsonify({"status": "ok"})
    except Exception:
        api_logger.exception("Error updating viewport")
        return jsonify({"error": "Internal server error"}), 500


# ============================================================================
# Блокировка карт (v2.0)
# ============================================================================


@maps_bp.route("/map/<int:map_id>/lock", methods=["PUT"])
@login_required
@require_map_lock
def toggle_map_lock(map_id):
    """
    Заблокировать/разблокировать карту.

    Требует права редактирования карты.
    """
    map_obj = Map.query.get_or_404(map_id)
    data = request.json or {}

    old_locked = map_obj.is_locked

    # Если не передано значение — переключаем
    locked_value = data.get("locked") if "locked" in data else None

    # Используем сервис для обновления
    map_obj = toggle_map_lock_service(map_id, locked_value)

    # Синхронизируем блокировку между клиентами (без полного reload карты —
    # элементы не менялись).
    notify_map_lock(map_id, map_obj.is_locked, current_user.id, current_user.username)

    # Аудит
    log_map_action(
        action="lock_map" if map_obj.is_locked else "unlock_map",
        map_id=map_id,
        map_name=map_obj.name,
        old_values={"is_locked": old_locked},
        new_values={"is_locked": map_obj.is_locked},
    )

    api_logger.info(
        f"Map lock toggled: map_id={map_id}, locked={map_obj.is_locked}, user={current_user.id}"
    )

    return jsonify(
        {
            "can_toggle_lock": can_toggle_map_lock(map_id),
            "id": map_id,
            "is_locked": map_obj.is_locked,
            "can_edit": can_edit_map(map_id),
        }
    )


@maps_bp.route("/map/<int:map_id>/lock", methods=["GET"])
@login_required
@require_map_access
def get_map_lock_status(map_id):
    """Получить статус блокировки карты."""
    map_obj = Map.query.get_or_404(map_id)
    return jsonify(
        {
            "id": map_id,
            "is_locked": map_obj.is_locked,
            "can_edit": can_edit_map(map_id),
            "can_toggle_lock": can_toggle_map_lock(map_id),
        }
    )
