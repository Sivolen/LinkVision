"""
API роуты для фигур (Shapes).
"""

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from services import map_service
from services.permissions import can_edit_map
from services.notifications import (
    notify_shape_created,
    notify_shape_updated,
    notify_shape_deleted,
)
from utils.logger import api_logger

shapes_bp = Blueprint("shapes", __name__)


@shapes_bp.route("/shape", methods=["POST"])
@login_required
def create_shape():
    """Создать фигуру на карте."""
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
        shape_data = {
            "id": shape.id,
            "shape_type": shape.shape_type,
            "x": shape.x,
            "y": shape.y,
            "width": shape.width,
            "height": shape.height,
            "color": shape.color,
            "opacity": shape.opacity,
            "description": shape.description,
        }
        notify_shape_created(shape.map_id, shape_data)
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

    data = request.json
    api_logger.info(
        f"🔷 API update_shape: shape_id={shape_id}, map_id={shape.map_id}, data={data}"
    )
    try:
        map_service.update_shape(shape_id, **data)
        shape_data = {
            "id": shape_id,
            "shape_type": shape.shape_type,
            "x": shape.x,
            "y": shape.y,
            "width": shape.width,
            "height": shape.height,
            "color": shape.color,
            "opacity": shape.opacity,
            "description": data.get("description", shape.description),
        }
        notify_shape_updated(shape.map_id, shape_data)
        api_logger.info(f"  ✅ shape_updated notified for map {shape.map_id}")
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
