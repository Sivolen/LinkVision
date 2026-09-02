"""
Сервис для импорта/экспорта карт.
"""

from models import (
    Map,
    Link,
    Device,
    Group,
    DeviceType,
    DeviceIP,
    db,
)
from utils.logger import api_logger


def _check_map_edit_permission(map_id: int) -> None:
    """Проверить право редактирования карты. Вызывает ValueError если нет доступа."""
    from services.permissions import can_edit_map

    if not can_edit_map(map_id):
        raise PermissionError("Доступ запрещён")


def export_map_data(map_id: int) -> dict:
    """
    Экспортировать карту в JSON-формат.

    Args:
        map_id: ID карты

    Returns:
        Dict с данными карты
    """
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
        }
        for link in map_obj.links
    ]

    groups = [{"id": g.id, "name": g.name, "color": g.color} for g in map_obj.groups]

    return {
        "id": map_obj.id,
        "name": map_obj.name,
        "background_image": map_obj.background_image,
        "owner_id": map_obj.owner_id,
        "devices": devices,
        "links": links,
        "groups": groups,
    }


def import_map(data: dict, current_user) -> Map:
    """
    Импортировать карту из JSON-данных с дедупликацией IP.

    Args:
        data: Данные карты для импорта
        current_user: Пользователь, выполняющий импорт

    Returns:
        Map: Импортированная/обновлённая карта
    """
    map_id = data.get("id")

    if map_id:
        map_obj = db.session.get(Map, map_id)

        if map_obj:
            # Если карта с таким ID уже есть в текущей БД, импорт работает как
            # обновление существующей карты. Право редактирования проверяем
            # только для этой ветки.
            _check_map_edit_permission(map_id)
            Link.query.filter_by(map_id=map_id).delete()
            Device.query.filter_by(map_id=map_id).delete()
            Group.query.filter_by(map_id=map_id).delete()
            db.session.flush()
        else:
            # ID из экспортированного JSON относится к исходной БД и вполне
            # может отсутствовать в БД назначения (особенно при импорте в
            # полностью пустую БД). Нельзя считать это ошибкой формата.
            map_obj = Map(
                name=data.get("name", "Imported Map"),
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

    # Импорт групп
    group_id_map = {}
    for g_data in data.get("groups", []):
        group = Group(
            name=g_data["name"], color=g_data.get("color", "#3498db"), map_id=map_obj.id
        )
        db.session.add(group)
        db.session.flush()
        group_id_map[g_data["id"]] = group.id

    # Кэш типов: name -> DeviceType (один запрос вместо N)
    type_cache = {dt.name: dt for dt in DeviceType.query.all()}

    # Импорт устройств
    device_id_map = {}
    for dev_data in data.get("devices", []):
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

        new_group_id = None
        old_group_id = dev_data.get("group_id")
        if old_group_id:
            new_group_id = group_id_map.get(old_group_id)

        dev = Device(
            map_id=map_obj.id,
            type_id=type_id,
            name=dev_data["name"],
            pos_x=dev_data.get("pos_x", 100),
            pos_y=dev_data.get("pos_y", 100),
            status=dev_data.get("status", "up"),
            group_id=new_group_id,
        )
        db.session.add(dev)
        db.session.flush()

        # Дедупликация IP
        seen_ips = set()
        for ip_str in dev_data.get("ips", []):
            if ip_str and ip_str.strip():
                clean_ip = ip_str.strip()
                if clean_ip not in seen_ips:
                    seen_ips.add(clean_ip)
                    db.session.add(DeviceIP(device_id=dev.id, ip_address=clean_ip))

        device_id_map[dev_data["id"]] = dev.id

    # Импорт связей
    for link_data in data.get("links", []):
        src_id = device_id_map.get(link_data["source_device_id"])
        tgt_id = device_id_map.get(link_data["target_device_id"])

        if not src_id or not tgt_id:
            api_logger.warning(
                f"Skipped link: source {link_data['source_device_id']} -> target {link_data['target_device_id']}"
            )
            continue

        link = Link(
            map_id=map_obj.id,
            source_device_id=src_id,
            target_device_id=tgt_id,
            source_interface=link_data.get("source_interface", "eth0"),
            target_interface=link_data.get("target_interface", "eth0"),
            link_type=link_data.get("link_type"),
            line_color=link_data.get("line_color", "#6c757d"),
            line_width=link_data.get("line_width", 2),
            line_style=link_data.get("line_style", "solid"),
        )
        db.session.add(link)

    db.session.commit()
    return map_obj
