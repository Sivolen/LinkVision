import os
from flask import Blueprint, request, jsonify, url_for, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from extensions import db
from models import Map, Device, DeviceType, Link, DeviceHistory, Group
from logger import api_logger
from functools import wraps

api_bp = Blueprint('api', __name__, url_prefix='/api')


def operator_forbidden(f):
    """Декоратор, запрещающий оператору выполнять изменяющие действия."""
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
    map_obj = Map.query.get_or_404(map_id)
    if not (current_user.is_admin or map_obj.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    nodes = []
    edges = []

    for dev in map_obj.devices:
        icon_url = None
        width = None
        height = None
        if dev.type:
            if dev.type.icon_filename:
                icon_url = url_for('static', filename=f'uploads/icons/{dev.type.icon_filename}')
                icon_url += f'?v={dev.type.id}'
            width = dev.type.width
            height = dev.type.height

        nodes.append({
            'group': 'nodes',
            'data': {
                'id': str(dev.id),
                'label': f"{dev.name}\n{dev.ip_address or ''}",
                'status': 'true' if dev.status else 'false',
                'monitoring_enabled': 'true' if dev.monitoring_enabled else 'false',
                'iconUrl': icon_url or '',
                'name': dev.name,
                'ip': dev.ip_address,
                'type': dev.type.name if dev.type else 'Unknown',
                'width': width,
                'height': height,
                'group_id': dev.group_id
            },
            'position': {'x': dev.pos_x or 100, 'y': dev.pos_y or 100}
        })

    for link in map_obj.links:
        if not link.source_device_id or not link.target_device_id:
            api_logger.warning(f"Skipping broken link {link.id}: missing source/target")
            continue

        source_exists = any(n['data']['id'] == str(link.source_device_id) for n in nodes)
        target_exists = any(n['data']['id'] == str(link.target_device_id) for n in nodes)

        if not source_exists or not target_exists:
            api_logger.warning(f"Skipping link {link.id}: node not found in map")
            continue

        edges.append({
            'group': 'edges',
            'data': {
                'id': str(link.id),
                'source': str(link.source_device_id),
                'target': str(link.target_device_id),
                'label': f"{link.source_interface or 'eth0'}↔{link.target_interface or 'eth0'}",
                'link_type': link.link_type,
                'color': link.line_color,
                'width': link.line_width,
                'style': link.line_style
            }
        })
    groups = [{'id': g.id, 'name': g.name, 'color': g.color} for g in map_obj.groups if g.devices.count() > 0]
    return jsonify({'nodes': nodes, 'edges': edges, 'groups': groups})


@api_bp.route('/device/<int:id>', methods=['GET'])
@login_required
def get_device(id):
    device = Device.query.get_or_404(id)
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
    device = Device.query.get_or_404(id)
    if not (current_user.is_admin or device.map.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    history = DeviceHistory.query.filter_by(device_id=id).order_by(DeviceHistory.timestamp.desc()).limit(50).all()
    return jsonify([{
        'id': h.id,
        'old_status': 'true' if h.old_status else 'false',
        'new_status': 'true' if h.new_status else 'false',
        'timestamp': h.timestamp.isoformat()
    } for h in history])


@api_bp.route('/device/<int:id>/details', methods=['GET'])
@login_required
def get_device_details(id):
    device = Device.query.get_or_404(id)
    if not (current_user.is_admin or device.map.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    data = {
        'id': device.id,
        'name': device.name,
        'ip_address': device.ip_address,
        'type_id': device.type_id,
        'type_name': device.type.name if device.type else None,
        'pos_x': device.pos_x,
        'pos_y': device.pos_y,
        'status': device.status,
        'last_check': device.last_check.isoformat() if device.last_check else None,
        'map_id': device.map_id,
        'group_id': device.group_id,
        'monitoring_enabled': device.monitoring_enabled,
    }
    history = DeviceHistory.query.filter_by(device_id=id).order_by(DeviceHistory.timestamp.desc()).limit(50).all()
    data['history'] = [{
        'old_status': 'true' if h.old_status else 'false',
        'new_status': 'true' if h.new_status else 'false',
        'timestamp': h.timestamp.isoformat()
    } for h in history]
    neighbors = []
    for link in device.source_links:
        neighbor = link.target
        if neighbor:
            neighbors.append({
                'device_id': neighbor.id,
                'device_name': neighbor.name,
                'interface': link.source_interface,
                'neighbor_interface': link.target_interface,
                'link_type': link.link_type,
                'color': link.line_color,
                'width': link.line_width,
                'style': link.line_style
            })
    for link in device.target_links:
        neighbor = link.source
        if neighbor:
            neighbors.append({
                'device_id': neighbor.id,
                'device_name': neighbor.name,
                'interface': link.target_interface,
                'neighbor_interface': link.source_interface,
                'link_type': link.link_type,
                'color': link.line_color,
                'width': link.line_width,
                'style': link.line_style
            })
    data['neighbors'] = neighbors
    return jsonify(data)


@api_bp.route('/map/<int:map_id>/groups', methods=['GET'])
@login_required
def get_groups(map_id):
    map_obj = Map.query.get_or_404(map_id)
    if not (current_user.is_admin or map_obj.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    groups = Group.query.filter_by(map_id=map_id).all()
    return jsonify([{
        'id': g.id,
        'name': g.name,
        'color': g.color,
        'device_count': g.devices.count()
    } for g in groups])


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
    map_obj = Map.query.get_or_404(id)
    if not (current_user.is_admin or map_obj.owner_id == current_user.id or current_user.is_operator):
        return jsonify({'error': 'Доступ запрещён'}), 403
    devices = []
    for dev in map_obj.devices:
        devices.append({
            'id': dev.id,
            'name': dev.name,
            'ip_address': dev.ip_address,
            'type_id': dev.type_id,
            'type_name': dev.type.name if dev.type else None,
            'pos_x': dev.pos_x,
            'pos_y': dev.pos_y,
            'status': dev.status,
            'icon_filename': dev.type.icon_filename if dev.type else None,
            'width': dev.type.width if dev.type else None,
            'height': dev.type.height if dev.type else None,
            'group_id': dev.group_id
        })
    links = []
    for link in map_obj.links:
        links.append({
            'id': link.id,
            'source_device_id': link.source_device_id,
            'target_device_id': link.target_device_id,
            'source_interface': link.source_interface,
            'target_interface': link.target_interface,
            'link_type': link.link_type,
            'line_color': link.line_color,
            'line_width': link.line_width,
            'line_style': link.line_style
        })
    groups = []
    for g in map_obj.groups:
        groups.append({
            'id': g.id,
            'name': g.name,
            'color': g.color
        })
    data = {
        'id': map_obj.id,
        'name': map_obj.name,
        'background_image': map_obj.background_image,
        'pan_x': map_obj.pan_x,
        'pan_y': map_obj.pan_y,
        'zoom': map_obj.zoom,
        'owner_id': map_obj.owner_id,
        'devices': devices,
        'links': links,
        'groups': groups
    }
    api_logger.info(f"Map {id} exported")
    return jsonify(data)


# ============================================================================
# POST, PUT, DELETE – запрещены оператору
# ============================================================================

@api_bp.route('/device', methods=['POST'])
@login_required
@operator_forbidden
def create_device():
    data = request.json
    dev = Device(
        map_id=data['map_id'],
        type_id=data['type_id'],
        name=data['name'],
        ip_address=data.get('ip_address'),
        pos_x=data.get('x', 100),
        pos_y=data.get('y', 100),
        group_id=data.get('group_id'),
        monitoring_enabled=data.get('monitoring_enabled', True)
    )
    db.session.add(dev)
    db.session.commit()
    api_logger.info(f"Device created: ID={dev.id}, name={dev.name}, map={dev.map_id}")
    return jsonify({'id': dev.id}), 201


@api_bp.route('/device/<int:id>', methods=['PUT', 'DELETE'])
@login_required
@operator_forbidden
def manage_device(id):
    device = Device.query.get_or_404(id)
    if not (current_user.is_admin or device.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    if request.method == 'DELETE':
        db.session.delete(device)
        db.session.commit()
        api_logger.info(f"Device deleted: ID={id}")
        return jsonify({'status': 'deleted', 'id': id})

    elif request.method == 'PUT':
        data = request.json
        if 'name' in data: device.name = data['name']
        if 'ip_address' in data: device.ip_address = data['ip_address']
        if 'type_id' in data: device.type_id = data['type_id']
        if 'pos_x' in data: device.pos_x = data['pos_x']
        if 'pos_y' in data: device.pos_y = data['pos_y']
        if 'group_id' in data: device.group_id = data['group_id']
        if 'monitoring_enabled' in data: device.monitoring_enabled = data['monitoring_enabled']
        db.session.commit()
        api_logger.info(f"Device updated: ID={id}")
        return jsonify({'status': 'ok', 'id': device.id})


@api_bp.route('/device/<int:id>/position', methods=['PUT'])
@login_required
@operator_forbidden
def update_position(id):
    dev = Device.query.get_or_404(id)
    if not (current_user.is_admin or dev.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    data = request.json
    dev.pos_x = data['x']
    dev.pos_y = data['y']
    if dev.pos_x < 0: dev.pos_x = 0
    if dev.pos_y < 0: dev.pos_y = 0
    db.session.commit()
    api_logger.info(f"Device position updated: ID={id} -> ({dev.pos_x}, {dev.pos_y})")
    return jsonify({'status': 'ok'})


@api_bp.route('/link', methods=['POST'])
@login_required
@operator_forbidden
def create_link():
    try:
        data = request.get_json()
        api_logger.info(f"Creating link: {data}")
        if not all(k in data for k in ['map_id', 'source_id', 'target_id']):
            return jsonify({'error': 'Missing required fields'}), 400
        source = Device.query.get(data['source_id'])
        target = Device.query.get(data['target_id'])
        if not source or not target:
            return jsonify({'error': 'Source or target device not found'}), 404
        link = Link(
            map_id=data['map_id'],
            source_device_id=data['source_id'],
            target_device_id=data['target_id'],
            source_interface=data.get('src_iface', 'eth0'),
            target_interface=data.get('tgt_iface', 'eth0'),
            link_type=data.get('link_type'),
            line_color=data.get('line_color', '#6c757d'),
            line_width=data.get('line_width', 2),
            line_style=data.get('line_style', 'solid')
        )
        db.session.add(link)
        db.session.commit()
        api_logger.info(f"Link created: ID={link.id}")
        return jsonify({'id': link.id}), 201
    except Exception as e:
        db.session.rollback()
        api_logger.error(f"Error creating link: {e}")
        return jsonify({'error': str(e)}), 500


@api_bp.route('/link/<int:id>', methods=['PUT'])
@login_required
@operator_forbidden
def update_link(id):
    link = Link.query.get_or_404(id)
    if not (current_user.is_admin or link.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    data = request.get_json()
    if 'source_interface' in data:
        link.source_interface = data['source_interface']
    if 'target_interface' in data:
        link.target_interface = data['target_interface']
    if 'link_type' in data:
        link.link_type = data['link_type']
    if 'line_color' in data:
        link.line_color = data['line_color']
    if 'line_width' in data:
        link.line_width = data['line_width']
    if 'line_style' in data:
        link.line_style = data['line_style']
    db.session.commit()
    api_logger.info(f"Link updated: ID={id}")
    return jsonify({'id': link.id, 'status': 'updated'})


@api_bp.route('/link/<int:id>', methods=['DELETE'])
@login_required
@operator_forbidden
def delete_link(id):
    link = Link.query.get_or_404(id)
    if not (current_user.is_admin or link.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    db.session.delete(link)
    db.session.commit()
    api_logger.info(f"Link deleted: ID={id}")
    return jsonify({'id': id, 'status': 'deleted'})


@api_bp.route('/link/<int:id>', methods=['PUT', 'DELETE'])
@login_required
@operator_forbidden
def manage_link(id):
    link = Link.query.get_or_404(id)
    if not (current_user.is_admin or link.map.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    if request.method == 'DELETE':
        db.session.delete(link)
        db.session.commit()
        api_logger.info(f"Link deleted (manage): ID={id}")
        return jsonify({'status': 'deleted', 'id': id})
    elif request.method == 'PUT':
        data = request.json
        if 'source_interface' in data: link.source_interface = data['source_interface']
        if 'target_interface' in data: link.target_interface = data['target_interface']
        db.session.commit()
        api_logger.info(f"Link updated (manage): ID={id}")
        return jsonify({'status': 'ok', 'id': link.id})


@api_bp.route('/map/<int:id>', methods=['PUT'])
@login_required
@operator_forbidden
def update_map(id):
    map_obj = Map.query.get_or_404(id)
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    data = request.form
    name = data.get('name')
    if name:
        map_obj.name = name
    if 'background' in request.files:
        file = request.files['background']
        if file and file.filename:
            api_logger.info(f"Received background file: {file.filename}")
            filename = secure_filename(f"map_{id}_{file.filename}")
            upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'maps')
            os.makedirs(upload_folder, exist_ok=True)
            full_path = os.path.join(upload_folder, filename)
            if not os.access(upload_folder, os.W_OK):
                api_logger.error(f"No write permission to {upload_folder}")
                return jsonify({'error': 'Нет прав на запись'}), 500
            try:
                file.save(full_path)
                if os.path.exists(full_path):
                    file_size = os.path.getsize(full_path)
                    api_logger.info(f"File saved, size: {file_size} bytes")
                else:
                    api_logger.error("File not found after saving!")
                    return jsonify({'error': 'Ошибка сохранения файла'}), 500
            except Exception as e:
                api_logger.error(f"Exception while saving file: {e}")
                return jsonify({'error': str(e)}), 500
            if map_obj.background_image and map_obj.background_image != filename:
                old_path = os.path.join(upload_folder, map_obj.background_image)
                if os.path.exists(old_path):
                    os.remove(old_path)
                    api_logger.info(f"Removed old background: {old_path}")
            map_obj.background_image = filename
        else:
            api_logger.warning("File is empty or has no name")
    else:
        api_logger.debug("No 'background' field in request")
    if data.get('remove_background') == 'true':
        if map_obj.background_image:
            old_path = os.path.join(current_app.root_path, 'static', 'uploads', 'maps', map_obj.background_image)
            if os.path.exists(old_path):
                os.remove(old_path)
                api_logger.info(f"Removed background by request: {old_path}")
            map_obj.background_image = None
    db.session.commit()
    return jsonify({
        'id': map_obj.id,
        'name': map_obj.name,
        'background': map_obj.background_image
    })


@api_bp.route('/map/<int:id>/viewport', methods=['PUT'])
@login_required
@operator_forbidden
def update_viewport(id):
    map_obj = Map.query.get_or_404(id)
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    data = request.json
    map_obj.pan_x = data.get('pan_x', 0)
    map_obj.pan_y = data.get('pan_y', 0)
    map_obj.zoom = data.get('zoom', 1)
    db.session.commit()
    api_logger.info(f"Viewport saved for map {id}: pan=({map_obj.pan_x},{map_obj.pan_y}), zoom={map_obj.zoom}")
    return jsonify({'status': 'ok'})


@api_bp.route('/map/import', methods=['POST'])
@login_required
@operator_forbidden
def import_map():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    map_id = data.get('id')
    if map_id:
        map_obj = Map.query.get(map_id)
        if not map_obj:
            return jsonify({'error': 'Map not found'}), 404
        if not (current_user.is_admin or map_obj.owner_id == current_user.id):
            return jsonify({'error': 'Access denied'}), 403
        Link.query.filter_by(map_id=map_id).delete()
        Device.query.filter_by(map_id=map_id).delete()
        Group.query.filter_by(map_id=map_id).delete()
        db.session.flush()
        api_logger.info(f"Deleted all devices, links, groups for map {map_id}")
    else:
        map_obj = Map(name=data.get('name', 'Imported Map'), owner_id=current_user.id)
        db.session.add(map_obj)
        db.session.flush()
    map_obj.name = data.get('name', map_obj.name)
    map_obj.background_image = data.get('background_image')
    map_obj.pan_x = data.get('pan_x', 0)
    map_obj.pan_y = data.get('pan_y', 0)
    map_obj.zoom = data.get('zoom', 1)
    group_id_map = {}
    groups_created = 0
    for g_data in data.get('groups', []):
        group = Group(
            name=g_data['name'],
            color=g_data.get('color', '#3498db'),
            map_id=map_obj.id
        )
        db.session.add(group)
        db.session.flush()
        group_id_map[g_data['id']] = group.id
        groups_created += 1
    api_logger.info(f"Groups created: {groups_created}")
    device_id_map = {}
    devices_created = 0
    for dev_data in data.get('devices', []):
        type_id = None
        type_name = dev_data.get('type_name')
        if type_name:
            dtype = DeviceType.query.filter_by(name=type_name).first()
            if not dtype:
                dtype = DeviceType(name=type_name, icon_filename='')
                db.session.add(dtype)
                db.session.flush()
            type_id = dtype.id
        else:
            type_id = dev_data.get('type_id')
        new_group_id = None
        old_group_id = dev_data.get('group_id')
        if old_group_id:
            new_group_id = group_id_map.get(old_group_id)
        dev = Device(
            map_id=map_obj.id,
            type_id=type_id,
            name=dev_data['name'],
            ip_address=dev_data.get('ip_address'),
            pos_x=dev_data.get('pos_x', 100),
            pos_y=dev_data.get('pos_y', 100),
            status=dev_data.get('status', True),
            group_id=new_group_id
        )
        db.session.add(dev)
        db.session.flush()
        device_id_map[dev_data['id']] = dev.id
        devices_created += 1
    api_logger.info(f"Devices created: {devices_created}")
    links_created = 0
    links_skipped = 0
    for link_data in data.get('links', []):
        src_id = device_id_map.get(link_data['source_device_id'])
        tgt_id = device_id_map.get(link_data['target_device_id'])
        if not src_id or not tgt_id:
            links_skipped += 1
            api_logger.warning(f"Skipped link: source {link_data['source_device_id']} -> target {link_data['target_device_id']} (missing in device_id_map)")
            continue
        link = Link(
            map_id=map_obj.id,
            source_device_id=src_id,
            target_device_id=tgt_id,
            source_interface=link_data.get('source_interface', 'eth0'),
            target_interface=link_data.get('target_interface', 'eth0'),
            link_type=link_data.get('link_type'),
            line_color=link_data.get('line_color', '#6c757d'),
            line_width=link_data.get('line_width', 2),
            line_style=link_data.get('line_style', 'solid')
        )
        db.session.add(link)
        links_created += 1
    api_logger.info(f"Links created: {links_created}, skipped: {links_skipped}")
    db.session.commit()
    api_logger.info(f"Map import completed, new map ID: {map_obj.id}")
    return jsonify({'id': map_obj.id, 'status': 'imported'})


@api_bp.route('/group', methods=['POST'])
@login_required
@operator_forbidden
def create_group():
    data = request.json
    map_id = data.get('map_id')
    if not map_id:
        return jsonify({'error': 'map_id required'}), 400
    map_obj = Map.query.get_or_404(map_id)
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    group = Group(
        name=data['name'],
        color=data.get('color', '#3498db'),
        map_id=map_id
    )
    db.session.add(group)
    db.session.commit()
    api_logger.info(f"Group created: ID={group.id}, name={group.name}, map={map_id}")
    return jsonify({'id': group.id}), 201


@api_bp.route('/group/<int:id>', methods=['PUT', 'DELETE'])
@login_required
@operator_forbidden
def manage_group(id):
    group = Group.query.get_or_404(id)
    map_obj = group.map
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403
    if request.method == 'DELETE':
        Device.query.filter_by(group_id=id).update({'group_id': None})
        db.session.delete(group)
        db.session.commit()
        api_logger.info(f"Group deleted: ID={id}")
        return jsonify({'status': 'deleted'})
    elif request.method == 'PUT':
        data = request.json
        if 'name' in data:
            group.name = data['name']
        if 'color' in data:
            group.color = data['color']
        db.session.commit()
        api_logger.info(f"Group updated: ID={id}")
        return jsonify({'status': 'updated'})