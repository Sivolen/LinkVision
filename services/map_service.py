"""
Сервис для работы с картами.

Бизнес-логика связанная с картами:
- CRUD операции с картами
- Элементы карты (устройства, связи, группы, фигуры)
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
    Device,
    User,
    UserMapSettings,
    db,
    DeviceIP,
    Link,
    MapShape,
)
from utils.logger import api_logger, main_logger
from services.db.map_repository import map_repo
from services.validators import validate_name
from services import link_service, group_service, shape_service, map_import_export_service

# Кэши
groups_cache: TTLCache = TTLCache(maxsize=100, ttl=60)
sidebar_cache: TTLCache = TTLCache(maxsize=100, ttl=10)
map_elements_cache: TTLCache = TTLCache(maxsize=50, ttl=30)  # Кэш элементов карты


# ─── Экспорт функций из подсервисов ────────────────────────────────────────────

get_link_by_id = link_service.get_link_by_id
create_link = link_service.create_link
update_link = link_service.update_link
delete_link = link_service.delete_link

get_group_by_id = group_service.get_group_by_id
create_group = group_service.create_group
update_group = group_service.update_group
delete_group = group_service.delete_group

get_map_shapes = shape_service.get_map_shapes
create_shape = shape_service.create_shape
update_shape = shape_service.update_shape
delete_shape = shape_service.delete_shape

export_map_data = map_import_export_service.export_map_data
import_map = map_import_export_service.import_map


# ─── Основная логика карт ─────────────────────────────────────────────────────


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


def get_shape_by_id(shape_id: int):
    """Получить фигуру по ID."""
    from models import MapShape
    return db.session.get(MapShape, shape_id)


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
    map_obj = db.session.get(Map, map_id)
    if not map_obj:
        raise ValueError(f"Map with id {map_id} not found")
    return map_obj


def validate_link(link_id: int):
    """
    Проверить существование связи.

    Args:
        link_id: ID связи

    Returns:
        Link: Объект связи

    Raises:
        ValueError: Если связь не найдена
    """
    from models import Link
    link = db.session.get(Link, link_id)
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
    map_obj = db.session.get(Map, map_id)
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
        Device.query.options(joinedload(Device.type), joinedload(Device.ips))
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

    result = {
        "nodes": nodes,
        "edges": edges,
        "groups": groups_out,
        "shapes": shapes_out,
    }

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

    counts = dict(
        db.session.query(Device.group_id, func.count(Device.id))
        .filter(Device.map_id == map_id, Device.group_id.isnot(None))
        .group_by(Device.group_id)
        .all()
    )
    result = [
        {
            "id": g.id,
            "name": g.name,
            "color": g.color,
            "font_size": g.font_size,
            "device_count": counts.get(g.id, 0),
        }
        for g in groups
    ]

    groups_cache[cache_key] = result
    return result


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


def toggle_map_lock(map_id: int, locked: Optional[bool] = None) -> Map:
    """
    Заблокировать или разблокировать карту.

    Args:
        map_id: ID карты
        locked: True для блокировки, False для разблокировки.
                Если None — переключить текущее состояние.

    Returns:
        Map: Обновлённая карта
    """
    map_obj = Map.query.get_or_404(map_id)

    if locked is None:
        map_obj.is_locked = not map_obj.is_locked
    else:
        map_obj.is_locked = bool(locked)

    db.session.commit()
    api_logger.info(f"Map lock toggled: map_id={map_id}, locked={map_obj.is_locked}")
    return map_obj


