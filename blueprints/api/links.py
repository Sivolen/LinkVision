"""
API роуты для связей (Links).
"""

from flask import Blueprint, request, jsonify
from flask_login import login_required

from services import (
    map_service,
    device_service,
    require_not_operator,
    can_edit_map,
    log_map_action,
)
from services.notifications import (
    notify_link_created,
    notify_link_updated,
    notify_link_deleted,
)
from utils.logger import api_logger

links_bp = Blueprint("links", __name__)


@links_bp.route("/link", methods=["POST"])
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

    # Проверка права редактирования карты
    if not can_edit_map(data["map_id"]):
        return jsonify({"error": "Доступ запрещён"}), 403

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

        link_data = {
            "id": link.id,
            "source_device_id": link.source_device_id,
            "target_device_id": link.target_device_id,
            "source_interface": link.source_interface,
            "target_interface": link.target_interface,
            "link_type": link.link_type,
            "line_color": link.line_color,
            "line_width": link.line_width,
            "line_style": link.line_style,
        }
        notify_link_created(data["map_id"], link_data)
        return jsonify({"id": link.id}), 201

    except ValueError as e:
        api_logger.warning(f"Validation error creating link: {e}")
        return jsonify({"error": str(e)}), 400
    except Exception:
        api_logger.exception("Error creating link")
        return jsonify({"error": "Internal server error"}), 500


@links_bp.route("/link/<int:link_id>", methods=["PUT"])
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
        link_data = {
            "id": link.id,
            "source_device_id": link.source_device_id,
            "target_device_id": link.target_device_id,
            "source_interface": link.source_interface,
            "target_interface": link.target_interface,
            "link_type": link.link_type,
            "line_color": link.line_color,
            "line_width": link.line_width,
            "line_style": link.line_style,
        }
        notify_link_updated(map_id, link_data)

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
    except Exception:
        api_logger.exception("Error updating link")
        return jsonify({"error": "Internal server error"}), 500


@links_bp.route("/link/<int:link_id>", methods=["DELETE"])
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
            old_values={
                "link_id": link_id,
                "source": link.source_device_id,
                "target": link.target_device_id,
            },
        )

        map_service.delete_link(link_id)
        notify_link_deleted(map_id, link_id)
        return jsonify({"id": link_id, "status": "deleted"})
    except Exception:
        api_logger.exception("Error deleting link")
        return jsonify({"error": "Internal server error"}), 500
