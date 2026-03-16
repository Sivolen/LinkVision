import os
from flask import Blueprint, request, jsonify, url_for, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from extensions import db
from models import Map, DeviceType
from services import device_service, map_service
from utils.logger import api_logger
from functools import wraps

api_bp = Blueprint('api', __name__, url_prefix='/api')


def operator_forbidden(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if current_user.is_operator:
            return jsonify({'error': 'Оператор не может выполнять это действие'}), 403
        return f(*args, **kwargs)
    return decorated_function


# ============================================================================
# GET-запросы (доступны оператору)
# ============================================================================

@api_bp.route('/maps')
@login_required
def get_maps():
    if current_user.is_admin or current_user.is_operator:
        maps = Map.query.all()
    else:
        maps = Map.query.filter_by(owner_id=current_user.id).all()
    return jsonify([{'id': m.id, 'name': m.name} for m in maps])


@api_bp.route('/map/<int:map_id>/elements')
@login_required
def get_elements(map_id):
    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({'error': 'Map not found'}), 404
    if not (current_user.is_admin or map_obj.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    try:
        elements = map_service.get_map_elements(map_id)
        return jsonify(elements)
    except Exception as e:
        api_logger.error(f"Error fetching map elements: {e}")
        return jsonify({'error': 'Internal server error'}), 500


@api_bp.route('/device/<int:id>', methods=['GET'])
@login_required
def get_device(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({'error': 'Device not found'}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    return jsonify({
        'id': device.id,
        'name': device.name,
        'ip_address': device.ip_address,
        'type_id': device.type_id,
        'pos_x': device.pos_x,
        'pos_y': device.pos_y,
        'status': device.status,
        'monitoring_enabled': device.monitoring_enabled
    })


@api_bp.route('/device/<int:id>/history')
@login_required
def get_device_history(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({'error': 'Device not found'}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    history = device_service.get_device_history(id)
    return jsonify(history)


@api_bp.route('/device/<int:id>/details', methods=['GET'])
@login_required
def get_device_details(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({'error': 'Device not found'}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    try:
        data = device_service.get_device_details(id)
        return jsonify(data)
    except Exception as e:
        api_logger.error(f"Error fetching device details: {e}")
        return jsonify({'error': 'Internal server error'}), 500


@api_bp.route('/map/<int:map_id>/groups', methods=['GET'])
@login_required
def get_groups(map_id):
    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({'error': 'Map not found'}), 404
    if not (current_user.is_admin or map_obj.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    try:
        groups = map_service.get_map_groups(map_id)
        return jsonify(groups)
    except Exception as e:
        api_logger.error(f"Error fetching groups: {e}")
        return jsonify({'error': 'Internal server error'}), 500


@api_bp.route('/types')
@login_required
def get_types():
    types = DeviceType.query.all()
    return jsonify([{
        'id': t.id,
        'name': t.name,
        'width': t.width,
        'height': t.height
    } for t in types])


@api_bp.route('/map/<int:id>/export', methods=['GET'])
@login_required
def export_map(id):
    map_obj = map_service.get_map_by_id(id)
    if not map_obj:
        return jsonify({'error': 'Map not found'}), 404
    if not (current_user.is_admin or map_obj.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    try:
        data = map_service.export_map_data(id)
        return jsonify(data)
    except Exception as e:
        api_logger.error(f"Error exporting map: {e}")
        return jsonify({'error': 'Internal server error'}), 500


# ============================================================================
# POST, PUT, DELETE – запрещены оператору
# ============================================================================

@api_bp.route('/device', methods=['POST'])
@login_required
@operator_forbidden
def create_device():
    data = request.json
    try:
        dev = device_service.create_device(
            map_id=data['map_id'],
            type_id=data['type_id'],
            name=data['name'],
            ip_address=data.get('ip_address'),
            x=data.get('x', 100),
            y=data.get('y', 100),
            group_id=data.get('group_id'),
            monitoring_enabled=data.get('monitoring_enabled', True)
        )
        return jsonify({'id': dev.id}), 201
    except Exception as e:
        api_logger.error(f"Error creating device: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/device/<int:id>', methods=['PUT'])
@login_required
@operator_forbidden
def update_device(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({'error': 'Device not found'}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.json
    allowed_fields = ['name', 'ip_address', 'type_id', 'pos_x', 'pos_y', 'group_id', 'monitoring_enabled']
    update_data = {k: v for k, v in data.items() if k in allowed_fields}
    try:
        device_service.update_device(id, **update_data)
        return jsonify({'status': 'ok', 'id': id})
    except Exception as e:
        api_logger.error(f"Error updating device: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/device/<int:id>', methods=['DELETE'])
@login_required
@operator_forbidden
def delete_device(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({'error': 'Device not found'}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    try:
        device_service.delete_device(id)
        return jsonify({'status': 'deleted', 'id': id})
    except Exception as e:
        api_logger.error(f"Error deleting device: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/device/<int:id>/position', methods=['PUT'])
@login_required
@operator_forbidden
def update_position(id):
    device = device_service.get_device_by_id(id)
    if not device:
        return jsonify({'error': 'Device not found'}), 404
    if not (current_user.is_admin or device.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.json
    try:
        device_service.update_device_position(id, data['x'], data['y'])
        return jsonify({'status': 'ok'})
    except Exception as e:
        api_logger.error(f"Error updating position: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/link', methods=['POST'])
@login_required
@operator_forbidden
def create_link():
    data = request.get_json()
    if not all(k in data for k in ['map_id', 'source_id', 'target_id']):
        return jsonify({'error': 'Missing required fields'}), 400

    # Проверка существования устройств
    source = device_service.get_device_by_id(data['source_id'])
    target = device_service.get_device_by_id(data['target_id'])
    if not source or not target:
        return jsonify({'error': 'Source or target device not found'}), 404

    try:
        link = map_service.create_link(
            map_id=data['map_id'],
            source_id=data['source_id'],
            target_id=data['target_id'],
            src_iface=data.get('src_iface', 'eth0'),
            tgt_iface=data.get('tgt_iface', 'eth0'),
            link_type=data.get('link_type'),
            line_color=data.get('line_color', '#6c757d'),
            line_width=data.get('line_width', 2),
            line_style=data.get('line_style', 'solid')
        )
        return jsonify({'id': link.id}), 201
    except Exception as e:
        api_logger.error(f"Error creating link: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/link/<int:id>', methods=['PUT'])
@login_required
@operator_forbidden
def update_link(id):
    link = Link.query.get(id)  # можно было бы через map_service.get_link_by_id, но пока оставим
    if not link:
        return jsonify({'error': 'Link not found'}), 404
    if not (current_user.is_admin or link.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.get_json()
    try:
        map_service.update_link(id, **data)
        return jsonify({'id': id, 'status': 'updated'})
    except Exception as e:
        api_logger.error(f"Error updating link: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/link/<int:id>', methods=['DELETE'])
@login_required
@operator_forbidden
def delete_link(id):
    link = Link.query.get(id)
    if not link:
        return jsonify({'error': 'Link not found'}), 404
    if not (current_user.is_admin or link.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    try:
        map_service.delete_link(id)
        return jsonify({'id': id, 'status': 'deleted'})
    except Exception as e:
        api_logger.error(f"Error deleting link: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/map/<int:id>', methods=['PUT'])
@login_required
@operator_forbidden
def update_map(id):
    map_obj = map_service.get_map_by_id(id)
    if not map_obj:
        return jsonify({'error': 'Map not found'}), 404
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.form
    name = data.get('name')
    background_filename = None
    remove_background = data.get('remove_background') == 'true'

    if 'background' in request.files:
        file = request.files['background']
        if file and file.filename:
            filename = secure_filename(f"map_{id}_{file.filename}")
            upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'maps')
            os.makedirs(upload_folder, exist_ok=True)
            full_path = os.path.join(upload_folder, filename)
            try:
                file.save(full_path)
                background_filename = filename
            except Exception as e:
                api_logger.error(f"Exception while saving file: {e}")
                return jsonify({'error': str(e)}), 500

    try:
        map_service.update_map_details(id, name=name, background_filename=background_filename,
                                       remove_background=remove_background)
        return jsonify({
            'id': map_obj.id,
            'name': map_obj.name,
            'background': map_obj.background_image
        })
    except Exception as e:
        api_logger.error(f"Error updating map: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/map/<int:id>/viewport', methods=['PUT'])
@login_required
@operator_forbidden
def update_viewport(id):
    map_obj = map_service.get_map_by_id(id)
    if not map_obj:
        return jsonify({'error': 'Map not found'}), 404
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.json
    try:
        map_service.update_viewport(id, data.get('pan_x', 0), data.get('pan_y', 0), data.get('zoom', 1))
        return jsonify({'status': 'ok'})
    except Exception as e:
        api_logger.error(f"Error updating viewport: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/map/import', methods=['POST'])
@login_required
@operator_forbidden
def import_map():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    try:
        map_obj = map_service.import_map(data, current_user)
        return jsonify({'id': map_obj.id, 'status': 'imported'})
    except ValueError as e:
        return jsonify({'error': str(e)}), 404
    except Exception as e:
        api_logger.error(f"Error importing map: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/group', methods=['POST'])
@login_required
@operator_forbidden
def create_group():
    data = request.json
    map_id = data.get('map_id')
    if not map_id:
        return jsonify({'error': 'map_id required'}), 400

    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({'error': 'Map not found'}), 404
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    try:
        group = map_service.create_group(map_id, data['name'], data.get('color', '#3498db'))
        return jsonify({'id': group.id}), 201
    except Exception as e:
        api_logger.error(f"Error creating group: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/group/<int:id>', methods=['PUT'])
@login_required
@operator_forbidden
def update_group(id):
    group = Group.query.get(id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    map_obj = group.map
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.json
    try:
        map_service.update_group(id, name=data.get('name'), color=data.get('color'))
        return jsonify({'status': 'updated'})
    except Exception as e:
        api_logger.error(f"Error updating group: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/group/<int:id>', methods=['DELETE'])
@login_required
@operator_forbidden
def delete_group(id):
    group = Group.query.get(id)
    if not group:
        return jsonify({'error': 'Group not found'}), 404
    map_obj = group.map
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    try:
        map_service.delete_group(id)
        return jsonify({'status': 'deleted'})
    except Exception as e:
        api_logger.error(f"Error deleting group: {e}")
        return jsonify({'error': str(e)}), 500