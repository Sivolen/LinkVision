"""Сервис для импорта/экспорта карт."""

from models import (
    Device,
    DeviceHistory,
    DeviceIP,
    DeviceQualityHistory,
    DeviceType,
    Group,
    Link,
    Map,
    MapShape,
    db,
)
from services.permissions import can_edit_map
from utils.logger import api_logger


def _check_map_edit_permission(map_id: int) -> None:
    """Проверить право редактирования карты."""
    if not can_edit_map(map_id):
        raise PermissionError("Доступ запрещён")


def _id_key(value) -> str:
    """Нормализовать локальный ID из JSON для таблиц соответствий."""
    return str(value)


def export_map_data(map_id: int) -> dict:
    """Экспортировать карту вместе со всеми её визуальными элементами."""
    map_obj = Map.query.get_or_404(map_id)

    devices = [
        {
            "id": dev.id,
            "name": dev.name,
            "ips": [ip.ip_address for ip in dev.ips],
            "type_id": dev.type_id,
            "type_name": dev.type.name if dev.type else None,
            "pos_x": dev.pos_x,
            "pos_y": dev.pos_y,
            "status": dev.status,
            "monitoring_enabled": dev.monitoring_enabled,
            "font_size": dev.font_size,
            "icon_filename": dev.type.icon_filename if dev.type else None,
            "width": dev.type.width if dev.type else None,
            "height": dev.type.height if dev.type else None,
            "group_id": dev.group_id,
        }
        for dev in map_obj.devices
    ]

    links = [
        {
            "id": link.id,
            "source_device_id": link.source_device_id,
            "target_device_id": link.target_device_id,
            "source_interface": link.source_interface,
            "target_interface": link.target_interface,
            "link_type": link.link_type,
            "line_color": link.line_color,
            "line_width": link.line_width,
            "line_style": link.line_style,
            "font_size": link.font_size,
        }
        for link in map_obj.links
    ]

    groups = [
        {
            "id": group.id,
            "name": group.name,
            "color": group.color,
            "font_size": group.font_size,
            "parent_group_id": group.parent_group_id,
        }
        for group in map_obj.groups
    ]

    shapes = [
        {
            "id": shape.id,
            "shape_type": shape.shape_type,
            "x": shape.x,
            "y": shape.y,
            "width": shape.width,
            "height": shape.height,
            "font_size": shape.font_size,
            "color": shape.color,
            "opacity": shape.opacity,
            "description": shape.description,
        }
        for shape in MapShape.query.filter_by(map_id=map_id).all()
    ]

    return {
        "id": map_obj.id,
        "name": map_obj.name,
        "background_image": map_obj.background_image,
        "owner_id": map_obj.owner_id,
        "devices": devices,
        "links": links,
        "groups": groups,
        "shapes": shapes,
    }


def _validate_groups(groups_data: list) -> None:
    """Проверить ID и иерархию групп до изменения БД."""
    ids = set()
    for group_data in groups_data:
        if "id" not in group_data or "name" not in group_data:
            raise ValueError("Некорректный формат группы")
        key = _id_key(group_data["id"])
        if key in ids:
            raise ValueError("Дублирующийся ID группы")
        ids.add(key)

    for group_data in groups_data:
        parent_id = group_data.get("parent_group_id")
        if parent_id is not None and _id_key(parent_id) not in ids:
            raise ValueError("Родительская группа не найдена в импортируемой карте")


def _import_groups(map_id: int, groups_data: list) -> dict:
    """Импортировать группы в порядке родитель -> потомок."""
    group_id_map = {}
    pending = list(groups_data)

    while pending:
        progress = False
        next_pending = []
        for group_data in pending:
            parent_old_id = group_data.get("parent_group_id")
            if parent_old_id is not None and _id_key(parent_old_id) not in group_id_map:
                next_pending.append(group_data)
                continue

            parent_new_id = (
                group_id_map.get(_id_key(parent_old_id))
                if parent_old_id is not None
                else None
            )
            group = Group(
                name=group_data["name"],
                color=group_data.get("color", "#3498db"),
                font_size=group_data.get("font_size", 11),
                map_id=map_id,
                parent_group_id=parent_new_id,
            )
            db.session.add(group)
            db.session.flush()
            group_id_map[_id_key(group_data["id"])] = group.id
            progress = True

        if not progress:
            raise ValueError("Некорректная иерархия групп: обнаружен цикл")
        pending = next_pending

    return group_id_map


def import_map(data: dict, current_user) -> Map:
    """Импортировать карту с визуальными элементами и дедупликацией IP."""
    if not isinstance(data, dict):
        raise ValueError("Некорректный формат карты")

    for field in ("devices", "links", "groups", "shapes"):
        if field in data and not isinstance(data[field], list):
            raise ValueError(f"Поле '{field}' должно быть массивом")

    groups_data = data.get("groups", [])
    shapes_data = data.get("shapes", [])
    _validate_groups(groups_data)

    map_id = data.get("id")
    if map_id is not None:
        try:
            map_id = int(map_id)
        except (TypeError, ValueError):
            raise ValueError("ID карты должен быть числом")

    if map_id is not None:
        map_obj = db.session.get(Map, map_id)
        if map_obj:
            _check_map_edit_permission(map_id)
            # Содержимое карты заменяется, но её расположение в папке и права
            # доступа остаются свойствами существующей карты.
            Link.query.filter_by(map_id=map_id).delete(synchronize_session=False)
            device_ids = [
                device.id for device in Device.query.filter_by(map_id=map_id).all()
            ]
            if device_ids:
                DeviceQualityHistory.query.filter(
                    DeviceQualityHistory.device_id.in_(device_ids)
                ).delete(synchronize_session=False)
                DeviceHistory.query.filter(
                    DeviceHistory.device_id.in_(device_ids)
                ).delete(synchronize_session=False)
                DeviceIP.query.filter(DeviceIP.device_id.in_(device_ids)).delete(
                    synchronize_session=False
                )
            Device.query.filter_by(map_id=map_id).delete(synchronize_session=False)
            MapShape.query.filter_by(map_id=map_id).delete(synchronize_session=False)
            Group.query.filter_by(map_id=map_id).update(
                {Group.parent_group_id: None}, synchronize_session=False
            )
            Group.query.filter_by(map_id=map_id).delete(synchronize_session=False)
            db.session.flush()
        else:
            map_obj = Map(
                name=data.get("name") or "Imported Map",
                owner_id=current_user.id,
            )
            db.session.add(map_obj)
            db.session.flush()
    else:
        map_obj = Map(name=data.get("name", "Imported Map"), owner_id=current_user.id)
        db.session.add(map_obj)
        db.session.flush()

    map_obj.name = data.get("name", map_obj.name)
    map_obj.background_image = data.get("background_image")

    group_id_map = _import_groups(map_obj.id, groups_data)

    type_cache = {dt.name: dt for dt in DeviceType.query.all()}

    device_id_map = {}
    for dev_data in data.get("devices", []):
        if "id" not in dev_data or "name" not in dev_data:
            raise ValueError("Некорректный формат устройства")
        old_device_key = _id_key(dev_data["id"])
        if old_device_key in device_id_map:
            raise ValueError("Дублирующийся ID устройства")

        type_name = dev_data.get("type_name")
        if type_name:
            dtype = type_cache.get(type_name)
            if not dtype:
                dtype = DeviceType(name=type_name, icon_filename="")
                db.session.add(dtype)
                db.session.flush()
                type_cache[type_name] = dtype
            type_id = dtype.id
        else:
            type_id = dev_data.get("type_id")

        old_group_id = dev_data.get("group_id")
        new_group_id = (
            group_id_map.get(_id_key(old_group_id))
            if old_group_id is not None
            else None
        )
        if old_group_id is not None and new_group_id is None:
            raise ValueError("Устройство ссылается на отсутствующую группу")

        dev = Device(
            map_id=map_obj.id,
            type_id=type_id,
            name=dev_data["name"],
            pos_x=dev_data.get("pos_x", 100),
            pos_y=dev_data.get("pos_y", 100),
            status=dev_data.get("status", "up"),
            monitoring_enabled=dev_data.get("monitoring_enabled", True),
            font_size=dev_data.get("font_size"),
            group_id=new_group_id,
        )
        db.session.add(dev)
        db.session.flush()

        seen_ips = set()
        for ip_str in dev_data.get("ips", []):
            if ip_str and ip_str.strip():
                clean_ip = ip_str.strip()
                if clean_ip not in seen_ips:
                    seen_ips.add(clean_ip)
                    db.session.add(DeviceIP(device_id=dev.id, ip_address=clean_ip))

        device_id_map[old_device_key] = dev.id

    for link_data in data.get("links", []):
        src_old = link_data.get("source_device_id")
        tgt_old = link_data.get("target_device_id")
        src_id = device_id_map.get(_id_key(src_old)) if src_old is not None else None
        tgt_id = device_id_map.get(_id_key(tgt_old)) if tgt_old is not None else None

        if not src_id or not tgt_id:
            api_logger.warning(f"Skipped link: source {src_old} -> target {tgt_old}")
            continue

        db.session.add(
            Link(
                map_id=map_obj.id,
                source_device_id=src_id,
                target_device_id=tgt_id,
                source_interface=link_data.get("source_interface", "eth0"),
                target_interface=link_data.get("target_interface", "eth0"),
                link_type=link_data.get("link_type"),
                line_color=link_data.get("line_color", "#6c757d"),
                line_width=link_data.get("line_width", 2),
                line_style=link_data.get("line_style", "solid"),
                font_size=link_data.get("font_size", 8),
            )
        )

    for shape_data in shapes_data:
        required = ("shape_type", "x", "y", "width", "height")
        if any(field not in shape_data for field in required):
            raise ValueError("Некорректный формат фигуры")
        db.session.add(
            MapShape(
                map_id=map_obj.id,
                shape_type=shape_data["shape_type"],
                x=shape_data["x"],
                y=shape_data["y"],
                width=shape_data["width"],
                height=shape_data["height"],
                font_size=shape_data.get("font_size", 12),
                color=shape_data.get("color", "#3498db"),
                opacity=shape_data.get("opacity", 1.0),
                description=shape_data.get("description"),
            )
        )

    db.session.commit()
    return map_obj
