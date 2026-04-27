import os
import ipaddress
from flask import Blueprint, request, jsonify, current_app, url_for
from flask_login import login_required, current_user
from services import device_service, map_service
from utils.logger import api_logger
from functools import wraps
from utils.file_validation import safe_save_upload

api_bp = Blueprint("api", __name__, url_prefix="/api")


def operator_forbidden(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if current_user.is_operator:
            return jsonify({"error": "Оператор не может выполнять это действие"}), 403
        return f(*args, **kwargs)

    return decorated_function


def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            return jsonify({"error": "Требуются права администратора"}), 403
        return f(*args, **kwargs)

    return decorated_function


# ============================================================================
# GET-запросы (доступны оператору)
# ============================================================================


@api_bp.route("/maps")
@login_required
def get_maps():
    maps = map_service.get_available_maps(current_user)
    return jsonify([{"id": m.id, "name": m.name} for m in maps])


@api_bp.route("/map/<int:map_id>/elements")
@login_required
def get_elements(map_id):
    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({"error": "Map not found"}), 404
    if not (
        current_user.is_admin
        or map_obj.owner_id == current_user.id
        or current_user.is_operator
    ):
        return jsonify({"error": "Доступ запрещён"}), 403
    try:
        elements = map_service.get_map_elements(map_id)
        return jsonify(elements)
    except Exception as e:
        api_logger.error(f"Error fetching map elements: {e}")
        return jsonify({"error": "Internal server error"}), 500


@api_bp.route("/device/<int:id>", methods=["GET"])
@login_required
def get_device(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({"error": "Device not found"}), 404
    if not (
        current_user.is_admin
        or device.map.owner_id == current_user.id
        or current_user.is_operator
    ):
        return jsonify({"error": "Доступ запрещён"}), 403
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


@api_bp.route("/device/<int:id>/history")
@login_required
def get_device_history(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({"error": "Device not found"}), 404
    if not (
        current_user.is_admin
        or device.map.owner_id == current_user.id
        or current_user.is_operator
    ):
        return jsonify({"error": "Доступ запрещён"}), 403

    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 10, type=int)

    history = device_service.get_device_history(id, page=page, per_page=per_page)
    return jsonify(history)


@api_bp.route("/device/<int:id>/details", methods=["GET"])
@login_required
def get_device_details(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({"error": "Device not found"}), 404
    if not (
        current_user.is_admin
        or device.map.owner_id == current_user.id
        or current_user.is_operator
    ):
        return jsonify({"error": "Доступ запрещён"}), 403
    try:
        data = device_service.get_device_details(id)
        return jsonify(data)
    except Exception as e:
        api_logger.error(f"Error fetching device details: {e}")
        return jsonify({"error": "Internal server error"}), 500


@api_bp.route("/map/<int:map_id>/groups", methods=["GET"])
@login_required
def get_groups(map_id):
    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({"error": "Map not found"}), 404
    if not (
        current_user.is_admin
        or map_obj.owner_id == current_user.id
        or current_user.is_operator
    ):
        return jsonify({"error": "Доступ запрещён"}), 403
    try:
        groups = map_service.get_map_groups(map_id)
        return jsonify(groups)
    except Exception as e:
        api_logger.error(f"Error fetching groups: {e}")
        return jsonify({"error": "Internal server error"}), 500


@api_bp.route("/types")
@login_required
def get_types():
    types = device_service.get_all_device_types()
    return jsonify(
        [
            {"id": t.id, "name": t.name, "width": t.width, "height": t.height}
            for t in types
        ]
    )


@api_bp.route("/map/<int:id>/export", methods=["GET"])
@login_required
def export_map(id):
    map_obj = map_service.get_map_by_id(id)
    if not map_obj:
        return jsonify({"error": "Map not found"}), 404
    if not (
        current_user.is_admin
        or map_obj.owner_id == current_user.id
        or current_user.is_operator
    ):
        return jsonify({"error": "Доступ запрещён"}), 403
    try:
        data = map_service.export_map_data(id)
        return jsonify(data)
    except Exception as e:
        api_logger.error(f"Error exporting map: {e}")
        return jsonify({"error": "Internal server error"}), 500


# ============================================================================
# POST, PUT, DELETE – запрещены оператору
# ============================================================================


@api_bp.route("/device", methods=["POST"])
@login_required
@admin_required
def create_device():
    data = request.json
    if not data.get("map_id"):
        return jsonify({"error": "map_id is required"}), 400
    if not data.get("type_id"):
        return jsonify({"error": "type_id is required"}), 400
    if not data.get("name"):
        return jsonify({"error": "name is required"}), 400

    ips = data.get("ips", [])
    for ip in ips:
        if ip and ip.strip():
            try:
                ipaddress.ip_address(ip.strip())
            except ValueError:
                return jsonify({"error": f"Неверный формат IP-адреса: {ip}"}), 400

    try:
        map_service.validate_map(data["map_id"])
        device_service.validate_device_type(data["type_id"])
        if data.get("group_id"):
            device_service.validate_group_for_map(data["group_id"], data["map_id"])

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


@api_bp.route("/device/<int:id>", methods=["PUT"])
@login_required
@admin_required
def update_device(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({"error": "Device not found"}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403

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

    if "ips" in data:
        ips = data["ips"]
        for ip in ips:
            if ip and ip.strip():
                try:
                    ipaddress.ip_address(ip.strip())
                except ValueError:
                    return jsonify({"error": f"Неверный IP: {ip}"}), 400
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
        device_service.update_device(id, **update_data)
        # Инвалидация кэша сайдбара для владельца карты
        device = device_service.get_device_by_id(id)
        map_service.invalidate_sidebar_cache(device.map.owner_id)
        return jsonify({"status": "ok", "id": id})
    except ValueError as e:
        api_logger.warning(f"Validation error updating device {id}: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        api_logger.error(f"Error updating device: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/device/<int:id>", methods=["DELETE"])
@login_required
@admin_required
def delete_device(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({"error": "Device not found"}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403
    try:
        device_service.delete_device(id)
        return jsonify({"status": "deleted", "id": id})
    except Exception as e:
        api_logger.error(f"Error deleting device: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/device/<int:id>/position", methods=["PUT"])
@login_required
@admin_required
def update_position(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({"error": "Device not found"}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403

    data = request.json
    if "x" not in data or "y" not in data:
        return jsonify({"error": "x and y are required"}), 400
    try:
        device_service.update_device_position(id, data["x"], data["y"])
        return jsonify({"status": "ok"})
    except Exception as e:
        api_logger.error(f"Error updating position: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/link", methods=["POST"])
@login_required
@admin_required
def create_link():
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
        # Проверяем, что оба устройства принадлежат указанной карте
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
        return jsonify({"id": link.id}), 201
    except ValueError as e:
        api_logger.warning(f"Validation error creating link: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        api_logger.error(f"Error creating link: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/link/<int:id>", methods=["PUT"])
@login_required
@admin_required
def update_link(id):
    link = map_service.get_link_by_id(id)
    if not link:
        return jsonify({"error": "Link not found"}), 404
    if not (current_user.is_admin or link.map.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403

    data = request.get_json()
    try:
        map_service.update_link(id, **data)
        return jsonify({"id": id, "status": "updated"})
    except Exception as e:
        api_logger.error(f"Error updating link: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/link/<int:id>", methods=["DELETE"])
@login_required
@admin_required
def delete_link(id):
    link = map_service.get_link_by_id(id)
    if not link:
        return jsonify({"error": "Link not found"}), 404
    if not (current_user.is_admin or link.map.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403
    try:
        map_service.delete_link(id)
        return jsonify({"id": id, "status": "deleted"})
    except Exception as e:
        api_logger.error(f"Error deleting link: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/map/<int:id>", methods=["PUT"])
@login_required
@admin_required
def update_map(id):
    map_obj = map_service.get_map_by_id(id)
    if not map_obj:
        return jsonify({"error": "Map not found"}), 404
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403

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
            saved_name = safe_save_upload(file, upload_folder, prefix=f"map_{id}_")
            if saved_name:
                background_filename = saved_name
                # Удаляем старый фон, если он был
                if map_obj.background_image:
                    old_path = os.path.join(upload_folder, map_obj.background_image)
                    if os.path.exists(old_path):
                        os.remove(old_path)
            else:
                return jsonify({"error": "Недопустимый файл"}), 400

    try:
        map_service.update_map_details(
            id,
            name=name,
            background_filename=background_filename,
            remove_background=remove_background,
        )
        map_service.invalidate_sidebar_cache(map_obj.owner_id)
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


@api_bp.route("/map/<int:id>/viewport", methods=["PUT"])
@login_required
def update_viewport(id):
    map_obj = map_service.get_map_by_id(id)
    if not map_obj:
        return jsonify({"error": "Map not found"}), 404
    if not (
        current_user.is_admin
        or map_obj.owner_id == current_user.id
        or current_user.is_operator
    ):
        return jsonify({"error": "Доступ запрещён"}), 403

    data = request.json
    pan_x = data.get("pan_x", 0)
    pan_y = data.get("pan_y", 0)
    zoom = data.get("zoom", 1)

    api_logger.info(
        f"Received viewport update: user={current_user.id}, map={id}, pan=({pan_x}, {pan_y}), zoom={zoom}"
    )

    try:
        map_service.update_user_viewport(current_user.id, id, pan_x, pan_y, zoom)
        return jsonify({"status": "ok"})
    except Exception as e:
        api_logger.error(f"Error updating viewport: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/map/import", methods=["POST"])
@login_required
@admin_required
def import_map():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400
    try:
        map_obj = map_service.import_map(data, current_user)
        return jsonify({"id": map_obj.id, "status": "imported"})
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        api_logger.error(f"Error importing map: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/group", methods=["POST"])
@login_required
@admin_required
def create_group():
    data = request.json
    map_id = data.get("map_id")
    if not map_id:
        return jsonify({"error": "map_id required"}), 400
    if not data.get("name"):
        return jsonify({"error": "name required"}), 400

    try:
        # Валидация карты
        map_service.validate_map(map_id)
        # Валидация прав (уже сделано через admin_required и проверку доступа)
        map_obj = map_service.get_map_by_id(map_id)
        if not (current_user.is_admin or map_obj.owner_id == current_user.id):
            return jsonify({"error": "Доступ запрещён"}), 403
        font_size = data.get("font_size", 11)
        group = map_service.create_group(
            map_id, data["name"], data.get("color", "#3498db"), font_size
        )
        return jsonify({"id": group.id}), 201
    except ValueError as e:
        api_logger.warning(f"Validation error creating group: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        api_logger.error(f"Error creating group: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/group/<int:id>", methods=["PUT"])
@login_required
@admin_required
def update_group(id):
    group = map_service.get_group_by_id(id)
    if not group:
        return jsonify({"error": "Group not found"}), 404
    map_obj = group.map
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403

    data = request.json
    try:
        # Валидация (можно проверить, что название не пустое)
        name = data.get("name")
        if name is not None and (not name or len(name) < 2):
            return jsonify({"error": "Group name must be at least 2 characters"}), 400
        map_service.update_group(
            id,
            name=data.get("name"),
            color=data.get("color"),
            font_size=data.get("font_size"),
        )
        return jsonify({"status": "updated"})
    except ValueError as e:
        api_logger.warning(f"Validation error updating group {id}: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        api_logger.error(f"Error updating group: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/group/<int:id>", methods=["DELETE"])
@login_required
@admin_required
def delete_group(id):
    group = map_service.get_group_by_id(id)
    if not group:
        return jsonify({"error": "Group not found"}), 404
    map_obj = group.map
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403
    try:
        map_service.delete_group(id)
        return jsonify({"status": "deleted"})
    except Exception as e:
        api_logger.error(f"Error deleting group: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/devices/positions", methods=["PUT"])
@login_required
@admin_required
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
        if not (current_user.is_admin or device.map.owner_id == current_user.id):
            continue
        valid_updates.append({"id": device_id, "x": x, "y": y})

    if not valid_updates:
        return jsonify({"error": "No valid updates"}), 400

    try:
        updated = device_service.update_devices_positions(valid_updates)
        return jsonify({"status": "ok", "updated": updated})
    except Exception as e:
        api_logger.error(f"Error updating multiple positions: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/shape", methods=["POST"])
@login_required
@admin_required
def create_shape():
    data = request.json
    map_id = data.get("map_id")
    if not map_id:
        return jsonify({"error": "map_id required"}), 400
    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({"error": "Map not found"}), 404
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403
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
        return jsonify({"id": shape.id}), 201
    except Exception as e:
        api_logger.error(f"Error creating shape: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/shape/<int:id>", methods=["PUT"])
@login_required
@admin_required
def update_shape(id):
    shape = map_service.get_shape_by_id(id)
    if not shape:
        return jsonify({"error": "Shape not found"}), 404
    if not (current_user.is_admin or shape.map.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403

    data = request.json
    try:
        map_service.update_shape(id, **data)
        return jsonify({"id": id, "status": "updated"})
    except Exception as e:
        api_logger.error(f"Error updating shape: {e}")
        return jsonify({"error": str(e)}), 500


@api_bp.route("/shape/<int:id>", methods=["DELETE"])
@login_required
@admin_required
def delete_shape(id):
    shape = map_service.get_shape_by_id(id)
    if not shape:
        return jsonify({"error": "Shape not found"}), 404
    if not (current_user.is_admin or shape.map.owner_id == current_user.id):
        return jsonify({"error": "Доступ запрещён"}), 403
    try:
        map_service.delete_shape(id)
        return jsonify({"id": id, "status": "deleted"})
    except Exception as e:
        api_logger.error(f"Error deleting shape: {e}")
        return jsonify({"error": str(e)}), 500
