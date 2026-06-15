"""
Сервис для работы с картами.

Бизнес-логика связанная с картами:
- CRUD операции с картами
- Элементы карты (устройства, связи, группы, фигуры)
- Экспорт/импорт карт
- Настройки просмотра
"""

import os
from typing import Optional, List, Dict, Any
from cachetools import TTLCache

from flask import url_for
from sqlalchemy.orm import joinedload
from sqlalchemy import func

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
from services.db.map_repository import map_repo
from services.validators import validate_name

# Кэши
groups_cache: TTLCache = TTLCache(maxsize=100, ttl=60)
sidebar_cache: TTLCache = TTLCache(maxsize=100, ttl=10)
map_elements_cache: TTLCache = TTLCache(maxsize=50, ttl=30)  # Кэш элементов карты


def create_new_map(
    name: str, owner_id: int, background_image: Optional[str] = None
) -> Map:
    """
    Создать новую карту.

    Args:
        name: Название карты
        owner_id: ID владельца
        background_image: Имя файла фона

    Returns:
        Map: Созданная карта
    """
    return map_repo.create(name, owner_id, background_image)


def get_shape_by_id(shape_id: int) -> Optional[MapShape]:
    """Получить фигуру по ID."""
    return MapShape.query.get(shape_id)


def validate_map(map_id: int) -> Map:
    """
    Проверить существование карты.

    Args:
        map_id: ID карты

    Returns:
        Map: Объект карты

    Raises:
        ValueError: Если карта не найдена
    """
    map_obj = Map.query.get(map_id)
    if not map_obj:
        raise ValueError(f"Map with id {map_id} not found")
    return map_obj


def validate_link(link_id: int) -> Link:
    """
    Проверить существование связи.

    Args:
        link_id: ID связи

    Returns:
        Link: Объект связи

    Raises:
        ValueError: Если связь не найдена
    """
    link = Link.query.get(link_id)
    if not link:
        raise ValueError(f"Link with id {link_id} not found")
    return link


def invalidate_sidebar_cache(user_id: int) -> None:
    """Удалить кэшированные данные сайдбара для пользователя."""
    cache_key = f"sidebar_{user_id}"
    if cache_key in sidebar_cache:
        del sidebar_cache[cache_key]
        main_logger.debug(f"Sidebar cache invalidated for user {user_id}")


def invalidate_groups_cache(map_id: int) -> None:
    """Удалить кэш групп для указанной карты."""
    cache_key = f"groups_{map_id}"
    if cache_key in groups_cache:
        del groups_cache[cache_key]
        main_logger.debug(f"Groups cache invalidated for map {map_id}")


def invalidate_map_elements_cache(map_id: int) -> None:
    """Удалить кэш элементов карты при изменениях."""
    cache_key = f"map_elements_{map_id}"
    if cache_key in map_elements_cache:
        del map_elements_cache[cache_key]
        main_logger.debug(f"Map elements cache invalidated for map {map_id}")


def get_map_by_id(map_id: int) -> Optional[Map]:
    """Получить карту по ID или вернуть None."""
    return map_repo.get_by_id(map_id)


def get_map_info(map_id: int) -> Optional[Dict[str, Any]]:
    """
    Получить информацию о карте с статусом блокировки.

    Args:
        map_id: ID карты

    Returns:
        Dict с информацией о карте или None
    """
    map_obj = Map.query.get(map_id)
    if not map_obj:
        return None

    return {
        "id": map_obj.id,
        "name": map_obj.name,
        "owner_id": map_obj.owner_id,
        "is_locked": map_obj.is_locked,
        "background_image": map_obj.background_image,
        "created_at": map_obj.created_at.isoformat() if map_obj.created_at else None,
    }


def get_available_maps(user) -> List[Map]:
    """Получить карты, доступные пользователю."""
    return map_repo.get_available_for_user(user)


def get_sidebar_maps_data(user) -> List[Dict[str, Any]]:
    """
    Получить данные для сайдбара с кэшированием.

    Args:
        user: Объект пользователя

    Returns:
        List[Dict]: Список карт со счётчиками DOWN
    """
    cache_key = f"sidebar_{user.id}"
    if cache_key in sidebar_cache:
        main_logger.debug(f"Sidebar cache hit for user {user.id}")
        return sidebar_cache[cache_key]

    maps = get_available_maps(user)
    if not maps:
        return []

    map_ids = [m.id for m in maps]

    stats = (
        db.session.query(Device.map_id, func.count(Device.id).label("down_count"))
        .filter(
            Device.map_id.in_(map_ids),
            Device.monitoring_enabled,
            Device.status != "up",
        )
        .group_by(Device.map_id)
        .all()
    )

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
    return result


def delete_map_and_cleanup(map_id: int, app) -> int:
    """
    Удалить карту, связанные файлы и обновить last_map_id пользователей.

    Args:
        map_id: ID карты
        app: Flask приложение

    Returns:
        int: ID удалённой карты
    """
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


def get_user_settings(user_id: int, map_id: int) -> UserMapSettings:
    """
    Получить или создать настройки пользователя для карты.

    Args:
        user_id: ID пользователя
        map_id: ID карты

    Returns:
        UserMapSettings: Объект настроек
    """
    settings = UserMapSettings.query.filter_by(user_id=user_id, map_id=map_id).first()
    if not settings:
        settings = UserMapSettings(
            user_id=user_id, map_id=map_id, pan_x=0, pan_y=0, zoom=1
        )
        db.session.add(settings)
        db.session.commit()
    return settings


def update_user_viewport(
    user_id: int, map_id: int, pan_x: float, pan_y: float, zoom: float
) -> UserMapSettings:
    """
    Обновить настройки viewport пользователя.

    Args:
        user_id: ID пользователя
        map_id: ID карты
        pan_x: Позиция X
        pan_y: Позиция Y
        zoom: Масштаб

    Returns:
        UserMapSettings: Обновлённый объект настроек
    """
    try:
        # Нормализация значений
        pan_x = float(pan_x) if pan_x is not None else 0.0
        pan_y = float(pan_y) if pan_y is not None else 0.0
        zoom = float(zoom) if zoom is not None else 1.0

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


def get_map_elements(map_id: int) -> Dict[str, Any]:
    """
    Получить все элементы карты для Cytoscape с кэшированием.

    Args:
        map_id: ID карты

    Returns:
        Dict с узлами, рёбрами, группами и фигурами
    """
    # Проверка кэша
    cache_key = f"map_elements_{map_id}"
    if cache_key in map_elements_cache:
        api_logger.debug(f"Map elements cache hit for map {map_id}")
        return map_elements_cache[cache_key]

    # Проверка существования карты
    map_obj = Map.query.get_or_404(map_id)

    # Устройства с подгрузкой типов и IP (один запрос)
    # Используем joinedload для эффективной загрузки связанных данных
    devices = (
        Device.query.options(
            joinedload(Device.type),
            joinedload(Device.ips)
        )
        .filter_by(map_id=map_id)
        .all()
    )

    # Связи, фигуры, группы
    links = Link.query.filter_by(map_id=map_id).all()
    shapes = MapShape.query.filter_by(map_id=map_id).all()
    groups = Group.query.filter_by(map_id=map_id).all()

    # Группы с устройствами (один запрос)
    group_device_counts = (
        db.session.query(Group.id, func.count(Device.id).label("device_count"))
        .outerjoin(Device, Device.group_id == Group.id)
        .filter(Group.map_id == map_id)
        .group_by(Group.id)
        .having(func.count(Device.id) > 0)
        .all()
    )
    group_ids_with_devices = {gid for gid, _ in group_device_counts}

    # Формирование узлов
    nodes = []
    for dev in devices:
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

        ip_label = ", ".join([ip.ip_address for ip in dev.ips]) if dev.ips else ""

        nodes.append(
            {
                "group": "nodes",
                "data": {
                    "id": str(dev.id),
                    "label": f"{dev.name}\n{ip_label}",
                    "status": dev.status,
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

    # Формирование рёбер
    edges = []
    node_ids = {n["data"]["id"] for n in nodes}

    for link in links:
        if not (link.source_device_id and link.target_device_id):
            api_logger.warning(f"Skipping broken link {link.id}")
            continue

        src_id = str(link.source_device_id)
        tgt_id = str(link.target_device_id)

        if src_id not in node_ids or tgt_id not in node_ids:
            api_logger.warning(f"Skipping link {link.id}: node missing")
            continue

        edges.append(
            {
                "group": "edges",
                "data": {
                    "id": str(link.id),
                    "source": src_id,
                    "target": tgt_id,
                    "label": f"{link.source_interface or 'eth0'}↔{link.target_interface or 'eth0'}",
                    "link_type": link.link_type,
                    "color": link.line_color,
                    "width": link.line_width,
                    "style": link.line_style,
                    "font_size": link.font_size,
                },
            }
        )

    # Формирование фигур
    shapes_out = [
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
        for sh in shapes
    ]

    # Формирование групп (только с устройствами)
    groups_out = [
        {"id": g.id, "name": g.name, "color": g.color, "font_size": g.font_size}
        for g in groups
        if g.id in group_ids_with_devices
    ]

    result = {"nodes": nodes, "edges": edges, "groups": groups_out, "shapes": shapes_out}

    # Сохранение в кэш
    map_elements_cache[cache_key] = result
    api_logger.debug(f"Map elements cached for map {map_id}")

    return result


def get_map_groups(map_id: int) -> List[Dict[str, Any]]:
    """Получить группы карты с кэшированием."""
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


def export_map_data(map_id: int) -> Dict[str, Any]:
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


def update_map_details(
    map_id: int,
    name: Optional[str] = None,
    background_filename: Optional[str] = None,
    remove_background: bool = False,
) -> Map:
    """
    Обновить название и фон карты.

    Args:
        map_id: ID карты
        name: Новое название
        background_filename: Имя файла фона
        remove_background: Удалить фон

    Returns:
        Map: Обновлённая карта
    """
    return map_repo.update_details(map_id, name, background_filename, remove_background)


def create_link(
    map_id: int,
    source_id: int,
    target_id: int,
    src_iface: str = "eth0",
    tgt_iface: str = "eth0",
    link_type: Optional[str] = None,
    line_color: str = "#6c757d",
    line_width: int = 2,
    line_style: str = "solid",
    font_size: int = 8,
) -> Link:
    """
    Создать связь между устройствами.

    Args:
        map_id: ID карты
        source_id: ID исходного устройства
        target_id: ID целевого устройства
        src_iface: Интерфейс источника
        tgt_iface: Интерфейс цели
        link_type: Тип соединения
        line_color: Цвет линии
        line_width: Ширина линии
        line_style: Стиль линии
        font_size: Размер шрифта

    Returns:
        Link: Созданная связь
    """
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


def update_link(link_id: int, **kwargs: Any) -> Link:
    """
    Обновить поля связи.

    Args:
        link_id: ID связи
        **kwargs: Поля для обновления

    Returns:
        Link: Обновлённая связь
    """
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


def delete_link(link_id: int) -> int:
    """
    Удалить связь.

    Args:
        link_id: ID связи

    Returns:
        int: ID удалённой связи
    """
    link = Link.query.get_or_404(link_id)
    db.session.delete(link)
    db.session.commit()
    api_logger.info(f"Link deleted: ID={link_id}")
    return link_id


def create_group(
    map_id: int, name: str, color: str = "#3498db", font_size: int = 11
) -> Group:
    """
    Создать группу.

    Args:
        map_id: ID карты
        name: Название группы
        color: Цвет группы
        font_size: Размер шрифта

    Returns:
        Group: Созданная группа
    """
    group = Group(name=name, color=color, map_id=map_id, font_size=font_size)
    db.session.add(group)
    db.session.commit()
    api_logger.info(f"Group created: ID={group.id}, name={group.name}, map={map_id}")
    return group


def update_group(
    group_id: int,
    name: Optional[str] = None,
    color: Optional[str] = None,
    font_size: Optional[int] = None,
) -> Group:
    """
    Обновить группу.

    Args:
        group_id: ID группы
        name: Новое название
        color: Новый цвет
        font_size: Новый размер шрифта

    Returns:
        Group: Обновлённая группа
    """
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


def delete_group(group_id: int) -> int:
    """
    Удалить группу (устройства остаются без группы).

    Args:
        group_id: ID группы

    Returns:
        int: ID удалённой группы
    """
    group = Group.query.get_or_404(group_id)
    Device.query.filter_by(group_id=group_id).update({"group_id": None})
    db.session.delete(group)
    db.session.commit()
    api_logger.info(f"Group deleted: ID={group_id}")
    return group_id


def get_link_by_id(link_id: int) -> Optional[Link]:
    """Получить связь по ID или вернуть None."""
    return Link.query.get(link_id)


def get_group_by_id(group_id: int) -> Optional[Group]:
    """Получить группу по ID или вернуть None."""
    return Group.query.get(group_id)


def import_map(data: Dict[str, Any], current_user) -> Map:
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

    # Импорт групп
    group_id_map = {}
    for g_data in data.get("groups", []):
        group = Group(
            name=g_data["name"], color=g_data.get("color", "#3498db"), map_id=map_obj.id
        )
        db.session.add(group)
        db.session.flush()
        group_id_map[g_data["id"]] = group.id

    # Импорт устройств
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


def get_map_shapes(map_id: int) -> List[MapShape]:
    """Получить все фигуры карты."""
    return MapShape.query.filter_by(map_id=map_id).all()


def create_shape(
    map_id: int,
    shape_type: str,
    x: float,
    y: float,
    width: float,
    height: float,
    color: str,
    opacity: float,
    description: Optional[str] = None,
    font_size: int = 12,
) -> MapShape:
    """
    Создать фигуру на карте.

    Args:
        map_id: ID карты
        shape_type: Тип фигуры
        x: Позиция X
        y: Позиция Y
        width: Ширина
        height: Высота
        color: Цвет
        opacity: Прозрачность
        description: Описание
        font_size: Размер шрифта

    Returns:
        MapShape: Созданная фигура
    """
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


def update_shape(shape_id: int, **kwargs: Any) -> MapShape:
    """
    Обновить фигуру.

    Args:
        shape_id: ID фигуры
        **kwargs: Поля для обновления

    Returns:
        MapShape: Обновлённая фигура
    """
    shape = MapShape.query.get_or_404(shape_id)

    api_logger.info(f"🔷 update_shape called: shape_id={shape_id}, kwargs={kwargs}")

    if "font_size" in kwargs:
        shape.font_size = kwargs["font_size"]

    for key, value in kwargs.items():
        if hasattr(shape, key) and value is not None:
            old_value = getattr(shape, key)
            setattr(shape, key, value)
            if key in ['x', 'y']:
                api_logger.info(f"  🔶 Updating {key}: {old_value} -> {value}")

    db.session.commit()

    api_logger.info(f"  ✅ Shape saved: x={shape.x}, y={shape.y}")
    return shape


def delete_shape(shape_id: int) -> None:
    """
    Удалить фигуру.

    Args:
        shape_id: ID фигуры
    """
    shape = MapShape.query.get_or_404(shape_id)
    db.session.delete(shape)
    db.session.commit()
