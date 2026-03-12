import os
from flask import Blueprint, request, jsonify, url_for, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from extensions import db
from models import Map, Device, DeviceType, Link, DeviceHistory

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
                'iconUrl': icon_url or '',
                'name': dev.name,
                'ip': dev.ip_address,
                'type': dev.type.name if dev.type else 'Unknown',
                'width': width,
                'height': height
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
                'source': str(link.source_device_id),
                'target': str(link.target_device_id),
                'label': f"{link.source_interface or 'eth0'}↔{link.target_interface or 'eth0'}",
                # Новые поля
                'link_type': link.link_type,
                'color': link.line_color,
                'width': link.line_width,
                'style': link.line_style
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

    # Получаем размеры фона, если он есть
    max_x = None
    max_y = None
    if dev.map.background_image:
        # Здесь можно кэшировать размеры или читать из метаданных
        # Для простоты пока пропускаем, ограничение на клиенте (JS) основное
        pass

    # Применяем координаты
    dev.pos_x = data['x']
    dev.pos_y = data['y']

    # Опционально: проверка на отрицательные значения
    if dev.pos_x < 0: dev.pos_x = 0
    if dev.pos_y < 0: dev.pos_y = 0

    db.session.commit()
    return jsonify({'status': 'ok'})


@api_bp.route('/link', methods=['POST'])
@login_required
def create_link():
    try:
        data = request.get_json()
        print(f"🔗 Creating link: {data}")

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
            # Новые поля
            link_type=data.get('link_type'),
            line_color=data.get('line_color', '#6c757d'),
            line_width=data.get('line_width', 2),
            line_style=data.get('line_style', 'solid')
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
    # Новые поля
    if 'link_type' in data:
        link.link_type = data['link_type']
    if 'line_color' in data:
        link.line_color = data['line_color']
    if 'line_width' in data:
        link.line_width = data['line_width']
    if 'line_style' in data:
        link.line_style = data['line_style']

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
    return jsonify([{
        'id': t.id,
        'name': t.name,
        'width': t.width,
        'height': t.height
    } for t in types])


@api_bp.route('/map/<int:id>', methods=['PUT'])
@login_required
def update_map(id):
    map_obj = Map.query.get_or_404(id)
    if not current_user.is_admin and map_obj.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.form
    name = data.get('name')
    if name:
        map_obj.name = name

    # Обработка загружаемого фона
    if 'background' in request.files:
        file = request.files['background']
        if file and file.filename:
            print(f"📎 Получен файл: {file.filename}")
            filename = secure_filename(f"map_{id}_{file.filename}")
            upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'maps')
            os.makedirs(upload_folder, exist_ok=True)
            full_path = os.path.join(upload_folder, filename)

            # Проверка прав на запись
            if not os.access(upload_folder, os.W_OK):
                print(f"❌ Нет прав на запись в {upload_folder}")
                return jsonify({'error': 'Нет прав на запись'}), 500

            print(f"💾 Сохраняю файл фона: {full_path}")
            try:
                file.save(full_path)
                if os.path.exists(full_path):
                    file_size = os.path.getsize(full_path)
                    print(f"✅ Файл сохранён, размер: {file_size} байт")
                else:
                    print(f"❌ Файл не найден после сохранения!")
                    return jsonify({'error': 'Ошибка сохранения файла'}), 500
            except Exception as e:
                print(f"❌ Исключение при сохранении: {e}")
                return jsonify({'error': str(e)}), 500

            # Удаление старого фона (только если имя отличается)
            if map_obj.background_image and map_obj.background_image != filename:
                old_path = os.path.join(upload_folder, map_obj.background_image)
                if os.path.exists(old_path):
                    os.remove(old_path)
                    print(f"🗑️ Удалён старый фон: {old_path}")

            map_obj.background_image = filename
        else:
            print("⚠️ Файл не содержит имени или пустой")
    else:
        print("ℹ️ Поле 'background' отсутствует в запросе")

    # Удаление фона (если отмечен чекбокс)
    if data.get('remove_background') == 'true':
        if map_obj.background_image:
            old_path = os.path.join(current_app.root_path, 'static', 'uploads', 'maps', map_obj.background_image)
            if os.path.exists(old_path):
                os.remove(old_path)
                print(f"🗑️ Удалён фон по запросу: {old_path}")
            map_obj.background_image = None

    db.session.commit()
    return jsonify({
        'id': map_obj.id,
        'name': map_obj.name,
        'background': map_obj.background_image
    })


@api_bp.route('/map/<int:id>/viewport', methods=['PUT'])
@login_required
def update_viewport(id):
    map_obj = Map.query.get_or_404(id)
    if not current_user.is_admin and map_obj.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    data = request.json
    map_obj.pan_x = data.get('pan_x', 0)
    map_obj.pan_y = data.get('pan_y', 0)
    map_obj.zoom = data.get('zoom', 1)
    db.session.commit()
    return jsonify({'status': 'ok'})


@api_bp.route('/test_emit/<int:device_id>/<int:status>')
def test_emit(device_id, status):
    from extensions import socketio
    print(f"📤 Тестовая отправка device_status: id={device_id}, status={bool(status)}, map_id=1")
    socketio.emit('device_status', {
        'id': device_id,
        'status': bool(status),
        'map_id': 1
    })
    return 'ok'


@api_bp.route('/device/<int:id>/history')
@login_required
def get_device_history(id):
    device = Device.query.get_or_404(id)
    if not current_user.is_admin and device.map.owner_id != current_user.id:
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
    if not current_user.is_admin and device.map.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    # Базовая информация
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
        'map_id': device.map_id
    }

    # История изменений (последние 50 записей)
    from models import DeviceHistory
    history = DeviceHistory.query.filter_by(device_id=id).order_by(DeviceHistory.timestamp.desc()).limit(50).all()
    data['history'] = [{
        'old_status': 'true' if h.old_status else 'false',
        'new_status': 'true' if h.new_status else 'false',
        'timestamp': h.timestamp.isoformat()
    } for h in history]

    # Соседи (связи)
    neighbors = []
    # Исходящие связи
    for link in device.source_links:
        neighbor = link.target
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
    # Входящие связи
    for link in device.target_links:
        neighbor = link.source
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
