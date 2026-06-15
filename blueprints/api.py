"""
API Blueprint для LinkVision.

Оптимизированная версия с использованием:
- Декораторов permissions
- Валидаторов
- Сервисов для бизнес-логики
"""

import os
from flask import Blueprint, request, jsonify, current_app, url_for
from flask_login import login_required, current_user

from services import (
    device_service,
    map_service,
    require_admin,
    require_not_operator,
    require_map_access,
    require_map_edit,
    require_device_access,
    require_device_edit,
    require_map_owner_or_admin,
    can_edit_map,
    validate_ip_list,
    validate_name,
    get_cached_types,
    log_map_action,
    log_permission_action,
    log_device_action,
)
from services.audit_service import get_audit_logs, get_user_activity_summary
from models import Map, MapPermission, User
from extensions import db
from services.map_service import invalidate_groups_cache
from services.notifications import notify_map_updated
from utils.logger import api_logger
from utils.file_validation import safe_save_upload

api_bp = Blueprint("api", __name__, url_prefix="/api")


# ============================================================================
# GET-запросы (доступны оператору)
# ============================================================================


@api_bp.route("/maps")
@login_required
def get_maps():
    """Получить список доступных карт."""
    maps = map_service.get_available_maps(current_user)
    return jsonify([{"id": m.id, "name": m.name} for m in maps])


@api_bp.route("/map/<int:map_id>/elements")
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


@api_bp.route("/device/<int:device_id>", methods=["GET"])
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


@api_bp.route("/device/<int:device_id>/history")
@login_required
@require_device_access
def get_device_history(device_id):
    """Получить историю изменений устройства."""
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 10, type=int)
    history = device_service.get_device_history(device_id, page=page, per_page=per_page)
    return jsonify(history)


@api_bp.route("/device/<int:device_id>/details", methods=["GET"])
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


@api_bp.route("/map/<int:map_id>/groups", methods=["GET"])
@login_required
@require_map_access
def get_groups(map_id):
    """Получить группы карты."""
    try:
        api_logger.info(f"get_groups called for map_id={map_id}, user={current_user.id}")
        groups = map_service.get_map_groups(map_id)
        api_logger.info(f"Returning {len(groups)} groups: {groups}")
        return jsonify(groups)
    except Exception as e:
        api_logger.error(f"Error fetching groups: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@api_bp.route("/types")
@login_required
def get_types():
    """Получить типы устройств."""
    return jsonify(get_cached_types())


@api_bp.route("/map/<int:map_id>/export", methods=["GET"])
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
# POST, PUT, DELETE – запрещены оператору
# ============================================================================


@api_bp.route("/device", methods=["POST"])
@login_required
@require_not_operator
def create_device():
    """Создать новое устройство."""
    data = request.json

    # Валидация обязательных полей
    if not all(k in data for k in ["map_id", "type_id", "name"]):
        return jsonify({"error": "map_id, type_id, name required"}), 400

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

        notify_map_updated(data["map_id"])

        return (
            jsonify(
                {"id": dev.id, "iconUrl": icon_url, "width": width, "height": height}
            ),
            201,
        )

    except ValueError as e:
        api_logger.warning(f"Validation error creating device: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        api_logger.error(f"Error creating device: {e}")
        return jsonify({"error": "Internal server error"}), 500


@api_bp.route("/device/<int:device_id>", methods=["PUT"])
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
        notify_map_updated(device.map_id)

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
    except Exception as e:
        api_logger.error(f"Error updating device: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/device/<int:device_id>", methods=["DELETE"])
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
        notify_map_updated(map_id)
        return jsonify({"status": "deleted", "id": device_id})
    except Exception as e:
        api_logger.error(f"Error deleting device: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/device/<int:device_id>/position", methods=["PUT"])
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
        notify_map_updated(device.map_id)
        return jsonify({"status": "ok"})
    except Exception as e:
        api_logger.error(f"Error updating position: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/link", methods=["POST"])
@login_required
@require_not_operator
def create_link():
    """Создать связь между устройствами."""
    data = request.get_json()
    required = ["map_id", "source_id", "target_id"]

    if not all(k in data for k in required):
        return (
            jsonify({"error": "Missing required fields: map_id, source_id, target_id"}),
            400,
        )

    try:
        # Валидация карты
        map_service.validate_map(data["map_id"])

        # Валидация устройств
        source = device_service.get_device_by_id(data["source_id"])
        target = device_service.get_device_by_id(data["target_id"])

        if not source or not target:
            return jsonify({"error": "Source or target device not found"}), 404

        # Проверка принадлежности устройствам к карте
        if source.map_id != data["map_id"] or target.map_id != data["map_id"]:
            return jsonify({"error": "Both devices must belong to the same map"}), 400

        link = map_service.create_link(
            map_id=data["map_id"],
            source_id=data["source_id"],
            target_id=data["target_id"],
            src_iface=data.get("src_iface", "eth0"),
            tgt_iface=data.get("tgt_iface", "eth0"),
            link_type=data.get("link_type"),
            line_color=data.get("line_color", "#6c757d"),
            line_width=data.get("line_width", 2),
            line_style=data.get("line_style", "solid"),
            font_size=data.get("font_size", 8),
        )

        notify_map_updated(data["map_id"])
        return jsonify({"id": link.id}), 201

    except ValueError as e:
        api_logger.warning(f"Validation error creating link: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        api_logger.error(f"Error creating link: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/link/<int:link_id>", methods=["PUT"])
@login_required
def update_link(link_id):
    """Обновить связь."""
    link = map_service.get_link_by_id(link_id)
    if not link:
        return jsonify({"error": "Link not found"}), 404

    # Проверка права редактирования карты
    if not can_edit_map(link.map_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    data = request.get_json()
    try:
        # Сохраняем старые значения для аудита
        old_values = {
            "source_interface": link.source_interface,
            "target_interface": link.target_interface,
            "link_type": link.link_type,
            "line_color": link.line_color,
            "line_width": link.line_width,
            "line_style": link.line_style,
        }

        # Сохраняем map_id до обновления
        map_id = link.map_id

        link = map_service.update_link(link_id, **data)
        notify_map_updated(map_id)

        # Аудит
        new_values = {
            "source_interface": link.source_interface,
            "target_interface": link.target_interface,
            "link_type": link.link_type,
            "line_color": link.line_color,
            "line_width": link.line_width,
            "line_style": link.line_style,
        }
        log_map_action(
            action="update_link",
            map_id=map_id,
            map_name=f"Map {map_id}",
            old_values=old_values,
            new_values=new_values,
        )

        return jsonify({"id": link_id, "status": "updated"})
    except Exception as e:
        api_logger.error(f"Error updating link: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/link/<int:link_id>", methods=["DELETE"])
@login_required
def delete_link(link_id):
    """Удалить связь."""
    link = map_service.get_link_by_id(link_id)
    if not link:
        return jsonify({"error": "Link not found"}), 404

    # Проверка права редактирования карты
    if not can_edit_map(link.map_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    try:
        map_id = link.map_id
        map_name = f"Map {map_id}"

        # Аудит перед удалением
        log_map_action(
            action="delete_link",
            map_id=map_id,
            map_name=map_name,
            old_values={"link_id": link_id, "source": link.source_device_id, "target": link.target_device_id},
        )

        map_service.delete_link(link_id)
        notify_map_updated(map_id)
        return jsonify({"id": link_id, "status": "deleted"})
    except Exception as e:
        api_logger.error(f"Error deleting link: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/map/<int:map_id>", methods=["PUT"])
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
    except Exception as e:
        api_logger.error(f"Error updating map: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/map/<int:map_id>/viewport", methods=["PUT"])
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
    except Exception as e:
        api_logger.error(f"Error updating viewport: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@api_bp.route("/map/import", methods=["POST"])
@login_required
@require_not_operator
def import_map_route():
    """Импортировать карту из JSON."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    try:
        map_obj = map_service.import_map(data, current_user)
        notify_map_updated(map_obj.id)
        return jsonify({"id": map_obj.id, "status": "imported"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        api_logger.error(f"Error importing map: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/group", methods=["POST"])
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
        notify_map_updated(map_id)
        return jsonify({"id": group.id}), 201

    except ValueError as e:
        api_logger.warning(f"Validation error creating group: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        api_logger.error(f"Error creating group: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/group/<int:group_id>", methods=["PUT"])
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
        notify_map_updated(map_id)
        return jsonify({"status": "updated"})

    except ValueError as e:
        api_logger.warning(f"Validation error updating group {group_id}: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        api_logger.error(f"Error updating group: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/group/<int:group_id>", methods=["DELETE"])
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
        notify_map_updated(map_id)
        return jsonify({"status": "deleted"})
    except Exception as e:
        api_logger.error(f"Error deleting group: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/devices/positions", methods=["PUT"])
@login_required
@require_not_operator
def update_devices_positions():
    """Массовое обновление позиций устройств."""
    from services.permissions import can_edit_device

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
            notify_map_updated(first_device.map_id)
        return jsonify({"status": "ok", "updated": updated})
    except Exception as e:
        api_logger.error(f"Error updating multiple positions: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/shape", methods=["POST"])
@login_required
def create_shape():
    """Создать фигуру на карте."""
    from services.permissions import can_edit_map

    data = request.json
    map_id = data.get("map_id")

    if not map_id:
        return jsonify({"error": "map_id required"}), 400

    # Проверка прав вручную
    if not can_edit_map(map_id):
        return jsonify({"error": "Access denied"}), 403

    font_size = data.get("font_size", 12)

    try:
        shape = map_service.create_shape(
            map_id=map_id,
            shape_type=data["shape_type"],
            x=data["x"],
            y=data["y"],
            width=data["width"],
            height=data["height"],
            font_size=font_size,
            color=data.get("color", "#3498db"),
            opacity=data.get("opacity", 1.0),
            description=data.get("description"),
        )
        notify_map_updated(shape.map_id)
        return jsonify({"id": shape.id}), 201
    except Exception as e:
        api_logger.error(f"Error creating shape: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@api_bp.route("/shape/<int:shape_id>", methods=["PUT"])
@login_required
def update_shape(shape_id):
    """Обновить фигуру."""
    from services.permissions import can_edit_map

    shape = map_service.get_shape_by_id(shape_id)
    if not shape:
        return jsonify({"error": "Shape not found"}), 404

    # Проверка прав вручную
    if not can_edit_map(shape.map_id):
        return jsonify({"error": "Access denied"}), 403

    data = request.json
    api_logger.info(f"🔷 API update_shape: shape_id={shape_id}, map_id={shape.map_id}, data={data}")
    try:
        map_service.update_shape(shape_id, **data)
        notify_map_updated(shape.map_id)
        api_logger.info(f"  ✅ map_updated notified for map {shape.map_id}")
        return jsonify({"id": shape_id, "status": "updated", "x": shape.x, "y": shape.y})
    except Exception as e:
        api_logger.error(f"Error updating shape: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@api_bp.route("/shape/<int:shape_id>", methods=["DELETE"])
@login_required
def delete_shape(shape_id):
    """Удалить фигуру."""
    from services.permissions import can_edit_map

    shape = map_service.get_shape_by_id(shape_id)
    if not shape:
        return jsonify({"error": "Shape not found"}), 404

    # Проверка прав вручную
    if not can_edit_map(shape.map_id):
        return jsonify({"error": "Access denied"}), 403

    try:
        map_service.delete_shape(shape_id)
        notify_map_updated(shape.map_id)
        return jsonify({"id": shape_id, "status": "deleted"})
    except Exception as e:
        api_logger.error(f"Error deleting shape: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


# ============================================================================
# Блокировка карт (v2.0)
# ============================================================================


@api_bp.route("/map/<int:map_id>/lock", methods=["PUT"])
@login_required
@require_map_edit
def toggle_map_lock(map_id):
    """
    Заблокировать/разблокировать карту.

    Требует права редактирования карты.
    """
    map_obj = Map.query.get_or_404(map_id)
    data = request.json or {}

    old_locked = map_obj.is_locked

    # Если не передано значение — переключаем
    if "locked" not in data:
        map_obj.is_locked = not map_obj.is_locked
    else:
        map_obj.is_locked = bool(data["locked"])

    db.session.commit()
    notify_map_updated(map_id)

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
        {"id": map_id, "is_locked": map_obj.is_locked, "can_edit": can_edit_map(map_id)}
    )


@api_bp.route("/map/<int:map_id>/lock", methods=["GET"])
@login_required
@require_map_access
def get_map_lock_status(map_id):
    """Получить статус блокировки карты."""
    map_obj = Map.query.get_or_404(map_id)
    return jsonify(
        {"id": map_id, "is_locked": map_obj.is_locked, "can_edit": can_edit_map(map_id)}
    )


# ============================================================================
# Управление правами доступа к картам (v2.0)
# ============================================================================


@api_bp.route("/map/<int:map_id>/permissions", methods=["GET"])
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
            user = User.query.get(perm.user_id)
            perm_data["user_id"] = user.id
            perm_data["username"] = user.username if user else "Unknown"
        result.append(perm_data)

    return jsonify(result)


@api_bp.route("/map/<int:map_id>/permissions", methods=["POST"])
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
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    # Проверка на дубликат
    existing = MapPermission.query.filter_by(map_id=map_id, user_id=user_id).first()
    if existing:
        return jsonify({"error": "Permission already exists for this user"}), 409

    # Создаём разрешение
    perm = MapPermission(map_id=map_id, user_id=user_id, role=role)
    db.session.add(perm)
    db.session.commit()

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


@api_bp.route("/map/<int:map_id>/permissions/<int:perm_id>", methods=["PUT"])
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
        perm.role = role
        db.session.commit()

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


@api_bp.route("/map/<int:map_id>/permissions/<int:perm_id>", methods=["DELETE"])
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

    db.session.delete(perm)
    db.session.commit()

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


@api_bp.route("/map/<int:map_id>/permissions/role", methods=["POST"])
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

    # Проверка на дубликат
    existing = MapPermission.query.filter_by(map_id=map_id, role=role).first()
    if existing:
        return jsonify({"error": "Role permission already exists"}), 409

    # Создаём разрешение
    perm = MapPermission(map_id=map_id, role=role)
    db.session.add(perm)
    db.session.commit()

    api_logger.info(
        f"Role permission added: map_id={map_id}, role={role}, by={current_user.id}"
    )

    return jsonify({"id": perm.id, "map_id": map_id, "role": role}), 201


# ============================================================================
# Аудит логирование (v2.0)
# ============================================================================


@api_bp.route("/audit/logs", methods=["GET"])
@login_required
@require_admin
def get_audit_logs_route():
    """
    Получить журнал аудита.

    Доступно: только администраторам.

    Query params:
    - user_id: фильтр по пользователю
    - target_type: фильтр по типу объекта (map, device, permission)
    - target_id: фильтр по ID объекта
    - action: фильтр по действию
    - date_from: начальная дата (ISO format)
    - date_to: конечная дата (ISO format)
    - page: номер страницы (default: 1)
    - per_page: записей на страницу (default: 50, max: 200)
    """
    from datetime import datetime

    # Параметры фильтрации
    user_id = request.args.get("user_id", type=int)
    target_type = request.args.get("target_type")
    target_id = request.args.get("target_id", type=int)
    action = request.args.get("action")

    # Даты
    date_from = None
    date_to = None

    if request.args.get("date_from"):
        try:
            date_from = datetime.fromisoformat(request.args.get("date_from"))
        except ValueError:
            return jsonify({"error": "Invalid date_from format"}), 400

    if request.args.get("date_to"):
        try:
            date_to = datetime.fromisoformat(request.args.get("date_to"))
        except ValueError:
            return jsonify({"error": "Invalid date_to format"}), 400

    # Пагинация
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 50, type=int)
    per_page = min(per_page, 200)  # Максимум 200 записей на страницу

    try:
        result = get_audit_logs(
            user_id=user_id,
            target_type=target_type,
            target_id=target_id,
            action=action,
            date_from=date_from,
            date_to=date_to,
            page=page,
            per_page=per_page,
        )
        return jsonify(result)
    except Exception as e:
        api_logger.error(f"Error fetching audit logs: {e}")
        return jsonify({"error": "Internal server error"}), 500


@api_bp.route("/audit/user/<int:user_id>/activity", methods=["GET"])
@login_required
@require_admin
def get_user_activity(user_id):
    """
    Получить сводку активности пользователя.

    Доступно: только администраторам.

    Query params:
    - days: количество дней (default: 7)
    """
    days = request.args.get("days", 7, type=int)
    days = min(days, 90)  # Максимум 90 дней

    try:
        result = get_user_activity_summary(user_id, days)
        return jsonify(result)
    except Exception as e:
        api_logger.error(f"Error fetching user activity: {e}")
        return jsonify({"error": "Internal server error"}), 500
