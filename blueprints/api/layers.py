"""Map layer API. Visibility is a personal preference and is never broadcast."""

from sqlalchemy import func
from sqlalchemy.orm import selectinload
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user

from models import db, Map, MapLayer, Device, Link, UserMapSettings
from services.permissions import can_edit_map, can_view_map
from services.notifications import notify_layers_updated

layers_bp = Blueprint("layers", __name__)


@layers_bp.before_request
def validate_json_object():
    if request.method in ("POST", "PUT") and not isinstance(request.get_json(silent=True), dict):
        return jsonify({"error": "Expected a JSON object"}), 400


def _editable_map(map_id):
    map_obj = db.session.get(Map, map_id)
    # Unlike several old endpoints, layer mutation respects the lock for every
    # role. A lock is a collaborative editing barrier, not just a UI hint.
    if not map_obj or not can_edit_map(map_id) or map_obj.is_locked:
        return None
    return map_obj


def _layer_payload(layer):
    return {
        "id": layer.id,
        "name": layer.name,
        "description": layer.description or "",
        "position": layer.position,
        "device_ids": [device.id for device in layer.devices],
        "link_ids": [link.id for link in layer.links],
        "device_count": len(layer.devices),
        "link_count": len(layer.links),
    }


def _map_layers(map_id):
    return MapLayer.query.options(selectinload(MapLayer.devices), selectinload(MapLayer.links)).filter_by(map_id=map_id).order_by(MapLayer.position, MapLayer.id).all()


def _valid_ids(values):
    if not isinstance(values, list):
        raise ValueError("Expected a list")
    if any(not isinstance(value, int) or isinstance(value, bool) for value in values):
        raise ValueError("Identifiers must be integers")
    return list(dict.fromkeys(values))


@layers_bp.route("/map/<int:map_id>/layers", methods=["GET"])
@login_required
def list_layers(map_id):
    if not can_view_map(map_id):
        return jsonify({"error": "Access denied"}), 403
    return jsonify({"layers": [_layer_payload(layer) for layer in _map_layers(map_id)]})


@layers_bp.route("/map/<int:map_id>/layers", methods=["POST"])
@login_required
def create_layer(map_id):
    if not _editable_map(map_id):
        return jsonify({"error": "Map is locked or access denied"}), 403
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    description = str(payload.get("description", "")).strip()
    if not name or len(name) > 64 or len(description) > 255:
        return jsonify({"error": "Invalid layer name or description"}), 400
    if MapLayer.query.filter_by(map_id=map_id, name=name).first():
        return jsonify({"error": "Layer name already exists"}), 409
    last_position = db.session.query(func.max(MapLayer.position)).filter_by(map_id=map_id).scalar()
    layer = MapLayer(map_id=map_id, name=name, description=description or None, position=(last_position or 0) + 1)
    db.session.add(layer)
    db.session.commit()
    notify_layers_updated(map_id, "created")
    return jsonify(_layer_payload(layer)), 201


@layers_bp.route("/map/<int:map_id>/layers/<int:layer_id>", methods=["PUT"])
@login_required
def update_layer(map_id, layer_id):
    if not _editable_map(map_id):
        return jsonify({"error": "Map is locked or access denied"}), 403
    layer = MapLayer.query.filter_by(id=layer_id, map_id=map_id).first()
    if not layer:
        return jsonify({"error": "Layer not found"}), 404
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", layer.name)).strip()
    description = str(payload.get("description", layer.description or "")).strip()
    if not name or len(name) > 64 or len(description) > 255:
        return jsonify({"error": "Invalid layer name or description"}), 400
    duplicate = MapLayer.query.filter(MapLayer.map_id == map_id, MapLayer.name == name, MapLayer.id != layer_id).first()
    if duplicate:
        return jsonify({"error": "Layer name already exists"}), 409
    layer.name, layer.description = name, description or None
    db.session.commit()
    notify_layers_updated(map_id, "updated")
    return jsonify(_layer_payload(layer))


@layers_bp.route("/map/<int:map_id>/layers/<int:layer_id>", methods=["DELETE"])
@login_required
def delete_layer(map_id, layer_id):
    if not _editable_map(map_id):
        return jsonify({"error": "Map is locked or access denied"}), 403
    layer = MapLayer.query.filter_by(id=layer_id, map_id=map_id).first()
    if not layer:
        return jsonify({"error": "Layer not found"}), 404
    # Remove stale IDs now, rather than leaving every client to repair them.
    for settings in UserMapSettings.query.filter_by(map_id=map_id).all():
        if isinstance(settings.visible_layer_ids, list) and layer_id in settings.visible_layer_ids:
            settings.visible_layer_ids = [item for item in settings.visible_layer_ids if item != layer_id]
    db.session.delete(layer)
    db.session.commit()
    notify_layers_updated(map_id, "deleted")
    return jsonify({"ok": True})


@layers_bp.route("/map/<int:map_id>/layers/order", methods=["PUT"])
@login_required
def reorder_layers(map_id):
    if not _editable_map(map_id):
        return jsonify({"error": "Map is locked or access denied"}), 403
    try:
        ids = _valid_ids((request.get_json(silent=True) or {}).get("layer_ids"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    layers = _map_layers(map_id)
    if set(ids) != {layer.id for layer in layers}:
        return jsonify({"error": "Layer list does not match map"}), 400
    by_id = {layer.id: layer for layer in layers}
    for position, layer_id in enumerate(ids):
        by_id[layer_id].position = position
    db.session.commit()
    notify_layers_updated(map_id, "reordered")
    return jsonify({"layers": [_layer_payload(layer) for layer in _map_layers(map_id)]})


@layers_bp.route("/map/<int:map_id>/layers/assignments", methods=["PUT"])
@login_required
def replace_assignments(map_id):
    if not _editable_map(map_id):
        return jsonify({"error": "Map is locked or access denied"}), 403
    payload = request.get_json(silent=True) or {}
    try:
        layer_ids = _valid_ids(payload.get("layer_ids", []))
        device_ids = _valid_ids(payload.get("device_ids", []))
        link_ids = _valid_ids(payload.get("link_ids", []))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    layers = MapLayer.query.filter(MapLayer.map_id == map_id, MapLayer.id.in_(layer_ids)).all() if layer_ids else []
    devices = Device.query.filter(Device.map_id == map_id, Device.id.in_(device_ids)).all() if device_ids else []
    links = Link.query.filter(Link.map_id == map_id, Link.id.in_(link_ids)).all() if link_ids else []
    if len(layers) != len(layer_ids) or len(devices) != len(device_ids) or len(links) != len(link_ids):
        return jsonify({"error": "Layer or element belongs to another map"}), 400
    selected_layers = set(layers)
    mode = payload.get("mode", "replace")
    if mode not in ("replace", "add"):
        return jsonify({"error": "Unknown assignment mode"}), 400
    for item in [*devices, *links]:
        item.map_layers = list((set(item.map_layers) | selected_layers) if mode == "add" else selected_layers)
    db.session.commit()
    notify_layers_updated(map_id, "assignments")
    return jsonify({"ok": True})


@layers_bp.route("/map/<int:map_id>/layer-visibility", methods=["GET", "PUT"])
@login_required
def layer_visibility(map_id):
    if not can_view_map(map_id):
        return jsonify({"error": "Access denied"}), 403
    settings = db.session.get(UserMapSettings, (current_user.id, map_id))
    all_ids = {row.id for row in db.session.query(MapLayer.id).filter_by(map_id=map_id).all()}
    if request.method == "PUT":
        try:
            visible = _valid_ids((request.get_json(silent=True) or {}).get("visible_layer_ids"))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        if not set(visible).issubset(all_ids):
            return jsonify({"error": "Unknown layer"}), 400
        if not settings:
            settings = UserMapSettings(user_id=current_user.id, map_id=map_id)
            db.session.add(settings)
        settings.visible_layer_ids = visible
        db.session.commit()
        return jsonify({"visible_layer_ids": visible})
    visible = settings.visible_layer_ids if settings and isinstance(settings.visible_layer_ids, list) else sorted(all_ids)
    cleaned = [item for item in visible if item in all_ids]
    if settings and cleaned != visible:
        settings.visible_layer_ids = cleaned
        db.session.commit()
    return jsonify({"visible_layer_ids": cleaned})
