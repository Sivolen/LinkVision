import ipaddress
from models import Device, DeviceIP, DeviceHistory, db, DeviceType, Group
from utils.logger import api_logger


def validate_device_type(type_id):
    dtype = DeviceType.query.get(type_id)
    if not dtype:
        raise ValueError(f"Device type with id {type_id} not found")
    return dtype


def validate_group_for_map(group_id, map_id):
    if group_id is None:
        return None
    group = Group.query.get(group_id)
    if not group:
        raise ValueError(f"Group with id {group_id} not found")
    if group.map_id != map_id:
        raise ValueError(f"Group {group_id} does not belong to map {map_id}")
    return group


def get_device_by_id(device_id):
    return Device.query.get(device_id)


def get_device_history(device_id, page=1, per_page=10):
    query = DeviceHistory.query.filter_by(device_id=device_id).order_by(DeviceHistory.timestamp.desc())
    total = query.count()
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)
    items = [
        {
            "id": h.id,
            "old_status": h.old_status,
            "new_status": h.new_status,
            "timestamp": h.timestamp.isoformat(),
        }
        for h in paginated.items
    ]
    return {
        "items": items,
        "page": page,
        "pages": paginated.pages,
        "total": total,
        "per_page": per_page,
    }


def get_device_details(device_id):
    device = Device.query.get_or_404(device_id)
    history = get_device_history(device_id)
    neighbors = []

    for link in device.source_links:
        neighbor = link.target
        if neighbor:
            neighbors.append({
                "device_id": neighbor.id,
                "device_name": neighbor.name,
                "interface": link.source_interface,
                "neighbor_interface": link.target_interface,
                "link_type": link.link_type,
                "color": link.line_color,
                "width": link.line_width,
                "style": link.line_style,
            })
    for link in device.target_links:
        neighbor = link.source
        if neighbor:
            neighbors.append({
                "device_id": neighbor.id,
                "device_name": neighbor.name,
                "interface": link.target_interface,
                "neighbor_interface": link.source_interface,
                "link_type": link.link_type,
                "color": link.line_color,
                "width": link.line_width,
                "style": link.line_style,
            })

    return {
        "id": device.id,
        "name": device.name,
        "ips": [ip.ip_address for ip in device.ips],
        "type_id": device.type_id,
        "type_name": device.type.name if device.type else None,
        "pos_x": device.pos_x,
        "pos_y": device.pos_y,
        "status": device.status,
        "last_check": device.last_check.isoformat() if device.last_check else None,
        "map_id": device.map_id,
        "group_id": device.group_id,
        "monitoring_enabled": device.monitoring_enabled,
        "history": history,
        "neighbors": neighbors,
    }


def create_device(map_id, type_id, name, ips=None, x=100, y=100, group_id=None, monitoring_enabled=True, font_size=None):
    device = Device(
        map_id=map_id,
        type_id=type_id,
        name=name,
        font_size=font_size,
        pos_x=x,
        pos_y=y,
        group_id=group_id,
        monitoring_enabled=monitoring_enabled,
        status='up'
    )
    db.session.add(device)
    db.session.flush()

    if ips:
        for ip in ips:
            if ip and ip.strip():
                try:
                    ipaddress.ip_address(ip.strip())
                except ValueError:
                    raise ValueError(f"Invalid IP address: {ip}")
                db.session.add(DeviceIP(device_id=device.id, ip_address=ip.strip()))

    db.session.commit()
    api_logger.info(f"Device created: ID={device.id}, name={device.name}, ips={ips}")
    return device


def update_device(device_id, **kwargs):
    device = Device.query.get_or_404(device_id)
    allowed_fields = ['name', 'type_id', 'pos_x', 'pos_y', 'group_id', 'monitoring_enabled', 'font_size']
    for key, value in kwargs.items():
        if key in allowed_fields:
            setattr(device, key, value)

    # Если мониторинг был выключен, а теперь включён – сбрасываем статус на 'up'
    if 'monitoring_enabled' in kwargs and kwargs['monitoring_enabled'] is True:
        device.status = 'up'
        device.last_check = db.func.now()

    if 'ips' in kwargs:
        new_ips = kwargs['ips']
        if new_ips is not None:
            for ip in new_ips:
                if ip and ip.strip():
                    try:
                        ipaddress.ip_address(ip.strip())
                    except ValueError:
                        raise ValueError(f"Invalid IP address: {ip}")
            existing = {ip.ip_address for ip in device.ips}
            new_set = {ip.strip() for ip in new_ips if ip and ip.strip()}
            for ip_obj in device.ips[:]:
                if ip_obj.ip_address not in new_set:
                    db.session.delete(ip_obj)
            for ip_str in new_set - existing:
                db.session.add(DeviceIP(device_id=device.id, ip_address=ip_str))

    db.session.commit()
    api_logger.info(f"Device updated: ID={device_id}")
    return device


def delete_device(device_id):
    device = Device.query.get_or_404(device_id)
    db.session.delete(device)
    db.session.commit()
    api_logger.info(f"Device deleted: ID={device_id}")


def update_device_position(device_id, x, y):
    device = Device.query.get_or_404(device_id)
    device.pos_x = x
    device.pos_y = y
    db.session.commit()
    api_logger.info(f"Device position updated: ID={device_id} -> ({x}, {y})")
    return device


def get_all_device_types():
    return DeviceType.query.all()


def update_devices_positions(updates):
    if not updates:
        return 0
    updated = 0
    for item in updates:
        device_id = item.get("id")
        x = item.get("x")
        y = item.get("y")
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
