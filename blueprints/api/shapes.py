"""
API роуты для фигур (Shapes).
"""

from flask import Blueprint, request, jsonify
from flask_login import login_required

from services import map_service
from services import shape_service
from extensions import db
from models import Map
from services.permissions import can_edit_map, can_view_map
from services.notifications import (
    notify_shape_created,
    notify_shape_updated,
    notify_shape_deleted,
)
from utils.logger import api_logger

shapes_bp = Blueprint("shapes", __name__)


def _shape_payload(shape):
    return {
        "id": shape.id,
        "shape_type": shape.shape_type,
        "target_map_id": shape.target_map_id,
        "portal_shape": shape.portal_shape,
        "x": shape.x,
        "y": shape.y,
        "width": shape.width,
        "height": shape.height,
        "color": shape.color,
        "opacity": shape.opacity,
        "description": shape.description,
        "font_size": shape.font_size,
    }


def _portal_fields(data, source_map_id, previous=None):
    shape_type = data.get("shape_type", previous.shape_type if previous else None)
    if shape_type != "map_link":
        if "shape_type" in data or "target_map_id" in data:
            data["target_map_id"] = None
        if "shape_type" in data or "portal_shape" in data:
            data["portal_shape"] = None
        return None
    if "portal_shape" in data and data["portal_shape"] not in ("rectangle", "square", "circle"):
        return jsonify({"error": "Invalid map link appearance"}), 400
    has_destination = "target_map_id" in data
    creating_portal = not previous or previous.shape_type != "map_link"
    if creating_portal or "description" in data:
        label = data.get("description", previous.description if previous else None)
        if not isinstance(label, str) or not 1 <= len(label.strip()) <= 255:
            return jsonify({"error": "Map link label required"}), 400
        data["description"] = label.strip()
    if creating_portal or has_destination:
        target = data.get("target_map_id")
        if type(target) is not int or not 1 <= target <= 2147483647 or target == source_map_id:
            return jsonify({"error": "Choose a different destination map"}), 400
        if not db.session.get(Map, target) or not can_view_map(target):
            return jsonify({"error": "Destination map is unavailable"}), 403
    return None


@shapes_bp.route("/shape", methods=["POST"])
@login_required
def create_shape():
    """Создать фигуру на карте."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    map_id = data.get("map_id")

    if type(map_id) is not int or not 1 <= map_id <= 2147483647:
        return jsonify({"error": "map_id required"}), 400

    # Проверка прав вручную
    if not can_edit_map(map_id):
        return jsonify({"error": "Access denied"}), 403

    error = _portal_fields(data, map_id)
    if error:
        return error
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
            target_map_id=data.get("target_map_id"),
            portal_shape=data.get("portal_shape"),
        )
        notify_shape_created(shape.map_id, _shape_payload(shape))
        return jsonify({"id": shape.id}), 201
    except Exception:
        api_logger.exception("Error creating shape")
        return jsonify({"error": "Internal server error"}), 500


@shapes_bp.route("/shape/<int:shape_id>", methods=["PUT"])
@login_required
def update_shape(shape_id):
    """Обновить фигуру."""
    shape = map_service.get_shape_by_id(shape_id)
    if not shape:
        return jsonify({"error": "Shape not found"}), 404

    # Проверка прав вручную
    if not can_edit_map(shape.map_id):
        return jsonify({"error": "Access denied"}), 403

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Expected a JSON object"}), 400
    error = _portal_fields(data, shape.map_id, shape)
    if error:
        return error
    try:
        shape_service.update_shape(shape_id, **data)
        notify_shape_updated(shape.map_id, _shape_payload(shape))
        api_logger.info(f"shape_updated notified for map {shape.map_id}")
        return jsonify(
            {"id": shape_id, "status": "updated", "x": shape.x, "y": shape.y}
        )
    except Exception:
        api_logger.exception("Error updating shape")
        return jsonify({"error": "Internal server error"}), 500


@shapes_bp.route("/shape/<int:shape_id>", methods=["DELETE"])
@login_required
def delete_shape(shape_id):
    """Удалить фигуру."""
    shape = map_service.get_shape_by_id(shape_id)
    if not shape:
        return jsonify({"error": "Shape not found"}), 404

    # Проверка прав вручную
    if not can_edit_map(shape.map_id):
        return jsonify({"error": "Access denied"}), 403

    try:
        map_service.delete_shape(shape_id)
        notify_shape_deleted(shape.map_id, shape_id)
        return jsonify({"id": shape_id, "status": "deleted"})
    except Exception:
        api_logger.exception("Error deleting shape")
        return jsonify({"error": "Internal server error"}), 500
