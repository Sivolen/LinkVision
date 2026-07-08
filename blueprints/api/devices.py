"""
API роуты для устройств (Devices).
"""

from flask import Blueprint, request, jsonify, url_for
from flask_login import login_required, current_user

from services import (
    device_service,
    map_service,
    require_not_operator,
    require_device_access,
    require_device_edit,
    validate_ip_list,
    validate_name,
    log_device_action,
)
from services.notifications import (
    notify_device_created,
    notify_device_updated,
    notify_device_deleted,
    notify_device_position_updated,
    notify_bulk_position_updated,
)
from services.permissions import can_edit_device, can_edit_map
from utils.logger import api_logger

devices_bp = Blueprint("devices", __name__)


# ============================================================================
# GET-запросы
# ============================================================================


@devices_bp.route("/device/<int:device_id>", methods=["GET"])
@login_required
@require_device_access
def get_device(device_id):
    """Получить устройство по ID."""
    device = device_service.get_device_by_id(device_id)
    return jsonify(
        {
            "id": device.id,
            "name": device.name,
            "ips": [ip.ip_address for ip in device.ips],
            "type_id": device.type_id,
            "pos_x": device.pos_x,
            "pos_y": device.pos_y,
            "status": device.status,
            "monitoring_enabled": device.monitoring_enabled,
        }
    )


@devices_bp.route("/device/<int:device_id>/history")
@login_required
@require_device_access
def get_device_history(device_id):
    """Получить историю изменений устройства."""
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 10, type=int)
    history = device_service.get_device_history(device_id, page=page, per_page=per_page)
    return jsonify(history)


@devices_bp.route("/device/<int:device_id>/details", methods=["GET"])
@login_required
@require_device_access
def get_device_details(device_id):
    """Получить детальную информацию об устройстве."""
    try:
        data = device_service.get_device_details(device_id)
        return jsonify(data)
    except Exception as e:
        api_logger.error(f"Error fetching device details: {e}")
        return jsonify({"error": "Internal server error"}), 500


# ============================================================================
# POST, PUT, DELETE – запрещены оператору
# ============================================================================


@devices_bp.route("/device", methods=["POST"])
@login_required
@require_not_operator
def create_device():
    """Создать новое устройство."""
    data = request.json

    # Валидация обязательных полей
    if not all(k in data for k in ["map_id", "type_id", "name"]):
        return jsonify({"error": "map_id, type_id, name required"}), 400

    # Проверка права редактирования карты
    if not can_edit_map(data["map_id"]):
        return jsonify({"error": "Доступ запрещён"}), 403

    # Валидация названия
    is_valid, error = validate_name(data["name"])
    if not is_valid:
        return jsonify({"error": error}), 400

    # Валидация IP
    ips, error = validate_ip_list(data.get("ips", []))
    if error:
        return jsonify({"error": error}), 400

    try:
        # Валидация через сервисы
        map_service.validate_map(data["map_id"])
        device_service.validate_device_type(data["type_id"])

        if data.get("group_id"):
            device_service.validate_group_for_map(data["group_id"], data["map_id"])

        api_logger.info(
            f"Creating device: map_id={data['map_id']}, type_id={data['type_id']}, name={data['name']}"
        )

        dev = device_service.create_device(
            map_id=data["map_id"],
            type_id=data["type_id"],
            name=data["name"],
            ips=ips,
            font_size=data.get("font_size"),
            x=data.get("x", 100),
            y=data.get("y", 100),
            group_id=data.get("group_id"),
            monitoring_enabled=data.get("monitoring_enabled", True),
        )

        dtype = dev.type
        icon_url = None
        width = None
        height = None

        if dtype and dtype.icon_filename:
            icon_url = (
                url_for("static", filename=f"uploads/icons/{dtype.icon_filename}")
                + f"?v={dtype.id}"
            )
            width = dtype.width
            height = dtype.height

        device_data = {
            "id": dev.id,
            "name": dev.name,
            "type_id": dev.type_id,
            "pos_x": dev.pos_x,
            "pos_y": dev.pos_y,
            "status": dev.status,
            "monitoring_enabled": dev.monitoring_enabled,
            "group_id": dev.group_id,
            "iconUrl": icon_url,
            "width": width,
            "height": height,
        }
        notify_device_created(data["map_id"], device_data)

        return (
            jsonify(
                {"id": dev.id, "iconUrl": icon_url, "width": width, "height": height}
            ),
            201,
        )

    except ValueError as e:
        api_logger.warning(f"Validation error creating device: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception:
        api_logger.exception("Error creating device")
        return jsonify({"error": "Internal server error"}), 500


@devices_bp.route("/device/<int:device_id>", methods=["PUT"])
@login_required
@require_device_edit
def update_device(device_id):
    """Обновить устройство."""
    device = device_service.get_device_by_id(device_id)
    if not device:
        return jsonify({"error": "Device not found"}), 404

    data = request.json
    allowed_fields = [
        "name",
        "type_id",
        "pos_x",
        "pos_y",
        "group_id",
        "monitoring_enabled",
    ]
    update_data = {k: v for k, v in data.items() if k in allowed_fields}

    # Валидация IP
    if "ips" in data:
        ips, error = validate_ip_list(data["ips"])
        if error:
            return jsonify({"error": error}), 400
        update_data["ips"] = ips

    if "font_size" in data:
        update_data["font_size"] = data["font_size"]

    try:
        if "type_id" in update_data:
            device_service.validate_device_type(update_data["type_id"])
        if "group_id" in update_data:
            device_service.validate_group_for_map(
                update_data["group_id"], device.map_id
            )

        # Сохраняем старые значения для аудита
        old_values = {
            "name": device.name,
            "type_id": device.type_id,
            "pos_x": device.pos_x,
            "pos_y": device.pos_y,
            "group_id": device.group_id,
            "monitoring_enabled": device.monitoring_enabled,
            "ips": [ip.ip_address for ip in device.ips],
        }

        device_service.update_device(device_id, **update_data)

        # Инвалидация кэша сайдбара
        device = device_service.get_device_by_id(device_id)
        map_service.invalidate_sidebar_cache(device.map.owner_id)

        device_data = {
            "id": device.id,
            "name": device.name,
            "type_id": device.type_id,
            "pos_x": device.pos_x,
            "pos_y": device.pos_y,
            "status": device.status,
            "monitoring_enabled": device.monitoring_enabled,
            "group_id": device.group_id,
        }
        notify_device_updated(device.map_id, device_data)

        # Аудит
        new_values = {
            "name": device.name,
            "type_id": device.type_id,
            "pos_x": device.pos_x,
            "pos_y": device.pos_y,
            "group_id": device.group_id,
            "monitoring_enabled": device.monitoring_enabled,
            "ips": [ip.ip_address for ip in device.ips],
        }
        log_device_action(
            action="update_device",
            device_id=device_id,
            device_name=device.name,
            map_id=device.map_id,
            old_values=old_values,
            new_values=new_values,
        )

        return jsonify({"status": "ok", "id": device_id})

    except ValueError as e:
        api_logger.warning(f"Validation error updating device {device_id}: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception:
        api_logger.exception(f"Error updating device {device_id}")
        return jsonify({"error": "Internal server error"}), 500


@devices_bp.route("/device/<int:device_id>", methods=["DELETE"])
@login_required
@require_device_edit
def delete_device(device_id):
    """Удалить устройство."""
    device = device_service.get_device_by_id(device_id)
    if not device:
        return jsonify({"error": "Device not found"}), 404

    try:
        map_id = device.map_id
        device_name = device.name

        # Аудит перед удалением
        log_device_action(
            action="delete_device",
            device_id=device_id,
            device_name=device_name,
            map_id=map_id,
            old_values={"name": device_name, "map_id": map_id},
        )

        device_service.delete_device(device_id)
        notify_device_deleted(map_id, device_id)
        return jsonify({"status": "deleted", "id": device_id})
    except Exception:
        api_logger.exception("Error deleting device")
        return jsonify({"error": "Internal server error"}), 500


@devices_bp.route("/device/<int:device_id>/position", methods=["PUT"])
@login_required
@require_device_edit
def update_position(device_id):
    """Обновить позицию устройства."""
    device = device_service.get_device_by_id(device_id)
    if not device:
        return jsonify({"error": "Device not found"}), 404

    data = request.json
    if "x" not in data or "y" not in data:
        return jsonify({"error": "x and y are required"}), 400

    try:
        device_service.update_device_position(device_id, data["x"], data["y"])
        notify_device_position_updated(device.map_id, device_id, data["x"], data["y"])
        return jsonify({"status": "ok"})
    except Exception:
        api_logger.exception("Error updating position")
        return jsonify({"error": "Internal server error"}), 500


@devices_bp.route("/devices/positions", methods=["PUT"])
@login_required
@require_not_operator
def update_devices_positions():
    """Массовое обновление позиций устройств."""
    data = request.json
    if not data or not isinstance(data, list):
        return jsonify({"error": "Invalid request, expected list of {id, x, y}"}), 400

    valid_updates = []
    for item in data:
        device_id = item.get("id")
        x = item.get("x")
        y = item.get("y")

        if device_id is None or x is None or y is None:
            continue

        device = device_service.get_device_by_id(device_id)
        if not device:
            continue

        # Используем функцию проверки прав
        if not can_edit_device(device_id):
            continue

        valid_updates.append({"id": device_id, "x": x, "y": y})

    if not valid_updates:
        return jsonify({"error": "No valid updates"}), 400

    try:
        updated = device_service.update_devices_positions(valid_updates)
        if valid_updates:
            first_device = device_service.get_device_by_id(valid_updates[0]["id"])
            device_ids = [u["id"] for u in valid_updates]
            notify_bulk_position_updated(first_device.map_id, device_ids)
        return jsonify({"status": "ok", "updated": updated})
    except Exception:
        api_logger.exception("Error updating multiple positions")
        return jsonify({"error": "Internal server error"}), 500
