from models import Device, DeviceHistory, db, DeviceType, Group
from utils.logger import api_logger


def validate_device_type(type_id):
    """Проверяет существование типа устройства."""
    dtype = DeviceType.query.get(type_id)
    if not dtype:
        raise ValueError(f"Device type with id {type_id} not found")
    return dtype


def validate_group_for_map(group_id, map_id):
    """Проверяет, что группа принадлежит указанной карте."""
    if group_id is None:
        return None
    group = Group.query.get(group_id)
    if not group:
        raise ValueError(f"Group with id {group_id} not found")
    if group.map_id != map_id:
        raise ValueError(f"Group {group_id} does not belong to map {map_id}")
    return group


def get_device_by_id(device_id):
    """Получить устройство по ID или None."""
    return Device.query.get(device_id)


def get_device_history(device_id, page=1, per_page=10):
    """Получить историю изменений статуса устройства с пагинацией."""
    query = DeviceHistory.query.filter_by(device_id=device_id).order_by(DeviceHistory.timestamp.desc())

    # Общее количество записей
    total = query.count()

    # Пагинация
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    items = [{
        'id': h.id,
        'old_status': 'true' if h.old_status else 'false',
        'new_status': 'true' if h.new_status else 'false',
        'timestamp': h.timestamp.isoformat()
    } for h in paginated.items]

    return {
        'items': items,
        'page': page,
        'pages': paginated.pages,
        'total': total,
        'per_page': per_page
    }


def get_device_details(device_id):
    device = Device.query.get_or_404(device_id)
    history = get_device_history(device_id)
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

    return {
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
        'history': history,
        'neighbors': neighbors,
    }


def create_device(map_id, type_id, name, ip_address=None, x=100, y=100, group_id=None, monitoring_enabled=True):
    """Создать новое устройство."""
    device = Device(
        map_id=map_id,
        type_id=type_id,
        name=name,
        ip_address=ip_address,
        pos_x=x,
        pos_y=y,
        group_id=group_id,
        monitoring_enabled=monitoring_enabled
    )
    db.session.add(device)
    db.session.commit()
    api_logger.info(f"Device created: ID={device.id}, name={device.name}, map={map_id}")
    return device


def update_device(device_id, **kwargs):
    """Обновить поля устройства (name, ip_address, type_id, pos_x, pos_y, group_id, monitoring_enabled)."""
    device = Device.query.get_or_404(device_id)
    allowed_fields = ['name', 'ip_address', 'type_id', 'pos_x', 'pos_y', 'group_id', 'monitoring_enabled']
    for key, value in kwargs.items():
        if key in allowed_fields:
            setattr(device, key, value)
    db.session.commit()
    api_logger.info(f"Device updated: ID={device_id}, fields={list(kwargs.keys())}")
    return device


def delete_device(device_id):
    """Удалить устройство."""
    device = Device.query.get_or_404(device_id)
    db.session.delete(device)
    db.session.commit()
    api_logger.info(f"Device deleted: ID={device_id}")


def update_device_position(device_id, x, y):
    """Обновить только позицию устройства."""
    device = Device.query.get_or_404(device_id)
    device.pos_x = x
    device.pos_y = y
    db.session.commit()
    api_logger.info(f"Device position updated: ID={device_id} -> ({x}, {y})")
    return device


def get_all_device_types():
    """Вернуть список всех типов устройств."""
    return DeviceType.query.all()


def update_devices_positions(updates):
    """
    Обновляет позиции нескольких устройств.
    updates: список словарей {'id': device_id, 'x': x, 'y': y}
    Возвращает количество обновлённых устройств.
    """
    if not updates:
        return 0

    updated = 0
    for item in updates:
        device_id = item.get('id')
        x = item.get('x')
        y = item.get('y')
        if device_id is None or x is None or y is None:
            continue
        device = Device.query.get(device_id)
        if not device:
            continue
        device.pos_x = x
        device.pos_y = y
        updated += 1
    db.session.commit()
    return updated
