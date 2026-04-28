import os
from cachetools import TTLCache
from flask import url_for
from models import (
    Map,
    Group,
    Link,
    Device,
    DeviceType,
    User,
    UserMapSettings,
    db,
    MapShape,
    DeviceIP,
)
from utils.logger import api_logger, main_logger

groups_cache = TTLCache(maxsize=100, ttl=60)

# Кэш для сайдбара: ключ = user_id, значение = результат, TTL 5 секунд
sidebar_cache = TTLCache(maxsize=100, ttl=10)


def get_shape_by_id(shape_id):
    return MapShape.query.get(shape_id)


def validate_map(map_id):
    """Проверяет существование карты. Возвращает карту или выбрасывает ValueError."""
    map_obj = Map.query.get(map_id)
    if not map_obj:
        raise ValueError(f"Map with id {map_id} not found")
    return map_obj


def validate_link(link_id):
    """Проверяет существование связи. Возвращает связь или выбрасывает ValueError."""
    link = Link.query.get(link_id)
    if not link:
        raise ValueError(f"Link with id {link_id} not found")
    return link


def invalidate_sidebar_cache(user_id):
    """Удаляет кэшированные данные сайдбара для пользователя."""
    cache_key = f"sidebar_{user_id}"
    if cache_key in sidebar_cache:
        del sidebar_cache[cache_key]
        main_logger.debug(f"Sidebar cache invalidated for user {user_id}")


def get_map_by_id(map_id):
    """Получить карту по ID или вернуть None."""
    return Map.query.get(map_id)


def get_available_maps(user):
    """Вернуть список карт, доступных пользователю."""
    if user.is_admin or user.is_operator:
        return Map.query.all()
    return Map.query.filter_by(owner_id=user.id).all()


def get_sidebar_maps_data(user):
    cache_key = f"sidebar_{user.id}"
    if cache_key in sidebar_cache:
        main_logger.debug(f"Sidebar cache hit for user {user.id}")
        return sidebar_cache[cache_key]

    maps = get_available_maps(user)
    if not maps:
        return []

    # Получаем ID всех доступных карт
    map_ids = [m.id for m in maps]

    # ОДИН запрос для подсчёта проблемных устройств по всем картам
    from sqlalchemy import func

    stats = (
        db.session.query(Device.map_id, func.count(Device.id).label("down_count"))
        .filter(
            Device.map_id.in_(map_ids),
            Device.monitoring_enabled is True,
            Device.status != "up",
        )
        .group_by(Device.map_id)
        .all()
    )

    # Преобразуем в словарь для быстрого доступа
    stat_dict = {stat[0]: stat[1] for stat in stats}

    result = []
    for m in maps:
        down_count = stat_dict.get(m.id, 0)
        result.append(
            {
                "id": m.id,
                "name": m.name,
                "owner_id": m.owner_id,
                "down_count": down_count,
            }
        )

    sidebar_cache[cache_key] = result
    main_logger.debug(f"Sidebar cache miss for user {user.id}, stored")
    return result


def delete_map_and_cleanup(map_id, app):
    """Удалить карту, связанные файлы и обновить last_map_id пользователей."""
    map_obj = Map.query.get_or_404(map_id)

    # Сброс last_map_id у пользователей
    User.query.filter_by(last_map_id=map_id).update({"last_map_id": None})

    # Удаление фонового изображения
    if map_obj.background_image:
        bg_path = os.path.join(
            app.config["UPLOAD_FOLDER"], "maps", map_obj.background_image
        )
        if os.path.exists(bg_path):
            os.remove(bg_path)

    # Удаление настроек пользователей для этой карты
    UserMapSettings.query.filter_by(map_id=map_id).delete()

    db.session.delete(map_obj)
    db.session.commit()
    return map_id


def get_user_settings(user_id, map_id):
    """Получить настройки пользователя для карты, при необходимости создать."""
    settings = UserMapSettings.query.filter_by(user_id=user_id, map_id=map_id).first()
    if not settings:
        settings = UserMapSettings(
            user_id=user_id, map_id=map_id, pan_x=0, pan_y=0, zoom=1
        )
        db.session.add(settings)
        db.session.commit()
    return settings


def update_user_viewport(user_id, map_id, pan_x, pan_y, zoom):
    try:
        settings = get_user_settings(user_id, map_id)
        settings.pan_x = pan_x
        settings.pan_y = pan_y
        settings.zoom = zoom
        db.session.commit()
        api_logger.info(
            f"Viewport UPDATED: user={user_id}, map={map_id}, pan=({pan_x}, {pan_y}), zoom={zoom}"
        )
        return settings
    except Exception as e:
        db.session.rollback()
        api_logger.error(f"Viewport UPDATE ERROR: {e}")
        raise


def get_map_elements(map_id):
    """Получить все элементы карты (устройства, связи, группы) для Cytoscape."""
    map_obj = Map.query.get_or_404(map_id)
    nodes = []
    edges = []

    for dev in map_obj.devices:
        icon_url = None
        width = None
        height = None
        if dev.type:
            if dev.type.icon_filename:
                icon_url = (
                    url_for(
                        "static", filename=f"uploads/icons/{dev.type.icon_filename}"
                    )
                    + f"?v={dev.type.id}"
                )
            width = dev.type.width
            height = dev.type.height

        # Формируем строку IP-адресов
        ip_label = ", ".join([ip.ip_address for ip in dev.ips]) if dev.ips else ""

        nodes.append(
            {
                "group": "nodes",
                "data": {
                    "id": str(dev.id),
                    "label": f"{dev.name}\n{ip_label}",
                    "status": dev.status,  # 'up', 'down', 'partial'
                    "monitoring_enabled": "true" if dev.monitoring_enabled else "false",
                    "iconUrl": icon_url or "",
                    "name": dev.name,
                    "ip": ip_label,
                    "fontSize": dev.font_size,
                    "type": dev.type.name if dev.type else "Unknown",
                    "width": width,
                    "height": height,
                    "group_id": dev.group_id,
                },
                "position": {"x": dev.pos_x or 100, "y": dev.pos_y or 100},
            }
        )

    for link in map_obj.links:
        if not (link.source_device_id and link.target_device_id):
            api_logger.warning(f"Skipping broken link {link.id}")
            continue
        source_exists = any(
            n["data"]["id"] == str(link.source_device_id) for n in nodes
        )
        target_exists = any(
            n["data"]["id"] == str(link.target_device_id) for n in nodes
        )
        if not (source_exists and target_exists):
            api_logger.warning(f"Skipping link {link.id}: node missing")
            continue
        edges.append(
            {
                "group": "edges",
                "data": {
                    "id": str(link.id),
                    "source": str(link.source_device_id),
                    "target": str(link.target_device_id),
                    "label": f"{link.source_interface or 'eth0'}↔{link.target_interface or 'eth0'}",
                    "link_type": link.link_type,
                    "color": link.line_color,
                    "width": link.line_width,
                    "style": link.line_style,
                    "font_size": link.font_size,
                },
            }
        )
    shapes = [
        {
            "id": sh.id,
            "shape_type": sh.shape_type,
            "x": sh.x,
            "y": sh.y,
            "width": sh.width,
            "height": sh.height,
            "color": sh.color,
            "opacity": sh.opacity,
            "description": sh.description,
            "font_size": sh.font_size,
        }
        for sh in map_obj.shapes
    ]

    groups = [
        {"id": g.id, "name": g.name, "color": g.color, "font_size": g.font_size}
        for g in map_obj.groups
        if g.devices.count() > 0
    ]
    return {"nodes": nodes, "edges": edges, "groups": groups, "shapes": shapes}


def get_map_groups(map_id):
    cache_key = f"groups_{map_id}"
    if cache_key in groups_cache:
        return groups_cache[cache_key]

    groups = Group.query.filter_by(map_id=map_id).all()
    result = [
        {
            "id": g.id,
            "name": g.name,
            "color": g.color,
            "font_size": g.font_size,
            "device_count": g.devices.count(),
        }
        for g in groups
    ]
    groups_cache[cache_key] = result
    return result


def export_map_data(map_id):
    """Экспортировать карту в JSON-формат."""
    map_obj = Map.query.get_or_404(map_id)
    devices = []
    for dev in map_obj.devices:
        devices.append(
            {
                "id": dev.id,
                "name": dev.name,
                "ips": [ip.ip_address for ip in dev.ips],  # сохраняем список IP
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
        )

    links = []
    for link in map_obj.links:
        links.append(
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
        )

    groups = []
    for g in map_obj.groups:
        groups.append({"id": g.id, "name": g.name, "color": g.color})

    return {
        "id": map_obj.id,
        "name": map_obj.name,
        "background_image": map_obj.background_image,
        "owner_id": map_obj.owner_id,
        "devices": devices,
        "links": links,
        "groups": groups,
    }


def update_map_details(
    map_id, name=None, background_filename=None, remove_background=False
):
    """Обновить название и фон карты."""
    map_obj = Map.query.get_or_404(map_id)
    if name is not None:
        map_obj.name = name
    if remove_background:
        map_obj.background_image = None
    elif background_filename is not None:
        map_obj.background_image = background_filename
    db.session.commit()
    return map_obj


def create_link(
    map_id,
    source_id,
    target_id,
    src_iface="eth0",
    tgt_iface="eth0",
    link_type=None,
    line_color="#6c757d",
    line_width=2,
    line_style="solid",
    font_size=8,
):
    """Создать связь между устройствами."""
    link = Link(
        map_id=map_id,
        source_device_id=source_id,
        target_device_id=target_id,
        source_interface=src_iface,
        target_interface=tgt_iface,
        link_type=link_type,
        line_color=line_color,
        line_width=line_width,
        line_style=line_style,
        font_size=font_size,
    )
    db.session.add(link)
    db.session.commit()
    api_logger.info(f"Link created: ID={link.id}")
    return link


def update_link(link_id, **kwargs):
    """Обновить поля связи."""
    link = Link.query.get_or_404(link_id)
    if "font_size" in kwargs:
        link.font_size = kwargs["font_size"]
    for field in [
        "source_interface",
        "target_interface",
        "link_type",
        "line_color",
        "line_width",
        "line_style",
    ]:
        if field in kwargs:
            setattr(link, field, kwargs[field])
    db.session.commit()
    api_logger.info(f"Link updated: ID={link_id}")
    return link


def delete_link(link_id):
    """Удалить связь."""
    link = Link.query.get_or_404(link_id)
    db.session.delete(link)
    db.session.commit()
    api_logger.info(f"Link deleted: ID={link_id}")
    return link_id


def create_group(map_id, name, color="#3498db", font_size=11):
    """Создать группу."""
    group = Group(name=name, color=color, map_id=map_id, font_size=font_size)
    db.session.add(group)
    db.session.commit()
    api_logger.info(f"Group created: ID={group.id}, name={group.name}, map={map_id}")
    return group


def update_group(group_id, name=None, color=None, font_size=None):
    """Обновить группу."""
    group = Group.query.get_or_404(group_id)
    if name is not None:
        group.name = name
    if color is not None:
        group.color = color
    if font_size is not None:
        group.font_size = font_size
    db.session.commit()
    api_logger.info(f"Group updated: ID={group_id}")
    return group


def delete_group(group_id):
    """Удалить группу (устройства остаются без группы)."""
    group = Group.query.get_or_404(group_id)
    Device.query.filter_by(group_id=group_id).update({"group_id": None})
    db.session.delete(group)
    db.session.commit()
    api_logger.info(f"Group deleted: ID={group_id}")
    return group_id


def get_link_by_id(link_id):
    """Получить связь по ID или вернуть None."""
    return Link.query.get(link_id)


def get_group_by_id(group_id):
    """Получить группу по ID или вернуть None."""
    return Group.query.get(group_id)


def import_map(data, current_user):
    """Импортировать карту из JSON-данных."""
    map_id = data.get("id")
    if map_id:
        map_obj = Map.query.get(map_id)
        if not map_obj:
            raise ValueError("Map not found")
        Link.query.filter_by(map_id=map_id).delete()
        Device.query.filter_by(map_id=map_id).delete()
        Group.query.filter_by(map_id=map_id).delete()
        db.session.flush()
    else:
        map_obj = Map(name=data.get("name", "Imported Map"), owner_id=current_user.id)
        db.session.add(map_obj)
        db.session.flush()

    map_obj.name = data.get("name", map_obj.name)
    map_obj.background_image = data.get("background_image")

    group_id_map = {}
    for g_data in data.get("groups", []):
        group = Group(
            name=g_data["name"], color=g_data.get("color", "#3498db"), map_id=map_obj.id
        )
        db.session.add(group)
        db.session.flush()
        group_id_map[g_data["id"]] = group.id

    device_id_map = {}
    for dev_data in data.get("devices", []):
        type_name = dev_data.get("type_name")
        if type_name:
            dtype = DeviceType.query.filter_by(name=type_name).first()
            if not dtype:
                dtype = DeviceType(name=type_name, icon_filename="")
                db.session.add(dtype)
                db.session.flush()
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

        # Добавляем IP с дедупликацией (защита от дублей внутри импортируемого JSON)
        seen_ips = set()
        for ip_str in dev_data.get("ips", []):
            if ip_str and ip_str.strip():
                clean_ip = ip_str.strip()
                if clean_ip not in seen_ips:
                    seen_ips.add(clean_ip)
                    db.session.add(DeviceIP(device_id=dev.id, ip_address=clean_ip))

        device_id_map[dev_data["id"]] = dev.id

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


def get_map_shapes(map_id):
    return MapShape.query.filter_by(map_id=map_id).all()


def create_shape(
    map_id,
    shape_type,
    x,
    y,
    width,
    height,
    color,
    opacity,
    description=None,
    font_size=12,
):
    shape = MapShape(
        map_id=map_id,
        shape_type=shape_type,
        x=x,
        y=y,
        width=width,
        height=height,
        font_size=font_size,
        color=color,
        opacity=opacity,
        description=description,
    )
    db.session.add(shape)
    db.session.commit()
    return shape


def update_shape(shape_id, **kwargs):
    shape = MapShape.query.get_or_404(shape_id)
    if "font_size" in kwargs:
        shape.font_size = kwargs["font_size"]
    for key, value in kwargs.items():
        if hasattr(shape, key) and value is not None:
            setattr(shape, key, value)
    db.session.commit()
    return shape


def delete_shape(shape_id):
    shape = MapShape.query.get_or_404(shape_id)
    db.session.delete(shape)
    db.session.commit()
