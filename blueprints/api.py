from flask import Blueprint, request, jsonify, url_for
from flask_login import login_required, current_user
from extensions import db
from models import Map, Device, DeviceType, Link

api_bp = Blueprint('api', __name__, url_prefix='/api')


@api_bp.route('/maps')
@login_required
def get_maps():
    if current_user.is_admin:
        maps = Map.query.all()
    else:
        maps = Map.query.filter_by(owner_id=current_user.id).all()
    return jsonify([{'id': m.id, 'name': m.name} for m in maps])


@api_bp.route('/map/<int:map_id>/elements')
@login_required
def get_elements(map_id):
    map_obj = Map.query.get_or_404(map_id)
    nodes = []
    edges = []

    # 1. Собираем узлы
    for dev in map_obj.devices:
        icon_url = None
        if dev.type and dev.type.icon_filename:
            icon_url = url_for('static', filename=f'uploads/icons/{dev.type.icon_filename}')
            icon_url += f'?v={dev.type.id}'

        nodes.append({
            'group': 'nodes',
            'data': {
                'id': str(dev.id),
                'label': f"{dev.name}\n{dev.ip_address or ''}",
                'status': 'true' if dev.status else 'false',
                'iconUrl': icon_url or '',
                'name': dev.name,
                'ip': dev.ip_address,
                'type': dev.type.name if dev.type else 'Unknown'
            },
            'position': {'x': dev.pos_x or 100, 'y': dev.pos_y or 100}
        })

    # 2. Собираем рёбра С ПРОВЕРКОЙ
    for link in map_obj.links:
        # ✅ Пропускаем связи, если нет источника или цели
        if not link.source_device_id or not link.target_device_id:
            print(f"⚠️ Skipping broken link {link.id}: missing source/target")
            continue

        # ✅ Пропускаем, если устройства удалены (защита от orphaned links)
        source_exists = any(n['data']['id'] == str(link.source_device_id) for n in nodes)
        target_exists = any(n['data']['id'] == str(link.target_device_id) for n in nodes)

        if not source_exists or not target_exists:
            print(f"⚠️ Skipping link {link.id}: node not found in map")
            continue

        edges.append({
            'group': 'edges',
            'data': {
                'id': str(link.id),
                'source': str(link.source_device_id),  # Теперь точно строка числа
                'target': str(link.target_device_id),
                'label': f"{link.source_interface or 'eth0'}↔{link.target_interface or 'eth0'}"
            }
        })

    return jsonify({'nodes': nodes, 'edges': edges})


# ✅ НОВЫЙ: Получение данных одного устройства (для редактирования)
@api_bp.route('/device/<int:id>', methods=['GET'])
@login_required
def get_device(id):
    device = Device.query.get_or_404(id)
    if not current_user.is_admin and device.map.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    return jsonify({
        'id': device.id,
        'name': device.name,
        'ip_address': device.ip_address,
        'type_id': device.type_id,
        'pos_x': device.pos_x,
        'pos_y': device.pos_y,
        'status': device.status
    })


@api_bp.route('/device', methods=['POST'])
@login_required
def create_device():
    data = request.json
    dev = Device(
        map_id=data['map_id'],
        type_id=data['type_id'],
        name=data['name'],
        ip_address=data.get('ip_address'),
        pos_x=data.get('x', 100),
        pos_y=data.get('y', 100)
    )
    db.session.add(dev)
    db.session.commit()
    return jsonify({'id': dev.id}), 201


@api_bp.route('/device/<int:id>', methods=['PUT', 'DELETE'])
@login_required
def manage_device(id):
    device = Device.query.get_or_404(id)
    if not current_user.is_admin and device.map.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    if request.method == 'DELETE':
        db.session.delete(device)
        db.session.commit()
        return jsonify({'status': 'deleted', 'id': id})

    elif request.method == 'PUT':
        data = request.json
        if 'name' in data: device.name = data['name']
        if 'ip_address' in data: device.ip_address = data['ip_address']
        if 'type_id' in data: device.type_id = data['type_id']
        if 'pos_x' in data: device.pos_x = data['pos_x']
        if 'pos_y' in data: device.pos_y = data['pos_y']
        db.session.commit()
        return jsonify({'status': 'ok', 'id': device.id})


@api_bp.route('/device/<int:id>/position', methods=['PUT'])
@login_required
def update_position(id):
    dev = Device.query.get_or_404(id)
    data = request.json
    dev.pos_x = data['x']
    dev.pos_y = data['y']
    db.session.commit()
    return jsonify({'status': 'ok'})


@api_bp.route('/link', methods=['POST'])
@login_required
def create_link():
    try:
        data = request.get_json()
        print(f"🔗 Creating link: {data}")  # Лог для отладки

        # Валидация данных
        if not all(k in data for k in ['map_id', 'source_id', 'target_id']):
            return jsonify({'error': 'Missing required fields'}), 400

        # Проверка существования устройств
        source = Device.query.get(data['source_id'])
        target = Device.query.get(data['target_id'])

        if not source or not target:
            return jsonify({'error': 'Source or target device not found'}), 404

        # Создание связи
        link = Link(
            map_id=data['map_id'],
            source_device_id=data['source_id'],
            target_device_id=data['target_id'],
            source_interface=data.get('src_iface', 'eth0'),
            target_interface=data.get('tgt_iface', 'eth0')
        )
        db.session.add(link)
        db.session.commit()

        print(f"✅ Link created: ID={link.id}")
        return jsonify({'id': link.id}), 201

    except Exception as e:
        db.session.rollback()
        print(f"❌ Error creating link: {e}")
        return jsonify({'error': str(e)}), 500


# === Обновление связи ===
@api_bp.route('/link/<int:id>', methods=['PUT'])
@login_required
def update_link(id):
    link = Link.query.get_or_404(id)

    if not current_user.is_admin and link.map.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.get_json()
    if 'source_interface' in data:
        link.source_interface = data['source_interface']
    if 'target_interface' in data:
        link.target_interface = data['target_interface']

    db.session.commit()
    return jsonify({'id': link.id, 'status': 'updated'})


# === Удаление связи ===
@api_bp.route('/link/<int:id>', methods=['DELETE'])
@login_required
def delete_link(id):
    link = Link.query.get_or_404(id)

    if not current_user.is_admin and link.map.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    db.session.delete(link)
    db.session.commit()
    return jsonify({'id': id, 'status': 'deleted'})


@api_bp.route('/link/<int:id>', methods=['PUT', 'DELETE'])
@login_required
def manage_link(id):
    link = Link.query.get_or_404(id)
    if not current_user.is_admin and link.map.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    if request.method == 'DELETE':
        db.session.delete(link)
        db.session.commit()
        return jsonify({'status': 'deleted', 'id': id})

    elif request.method == 'PUT':
        data = request.json
        if 'source_interface' in data: link.source_interface = data['source_interface']
        if 'target_interface' in data: link.target_interface = data['target_interface']
        db.session.commit()
        return jsonify({'status': 'ok', 'id': link.id})


@api_bp.route('/types')
@login_required
def get_types():
    types = DeviceType.query.all()
    return jsonify([{'id': t.id, 'name': t.name} for t in types])