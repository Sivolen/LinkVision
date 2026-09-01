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
    MapFolder,
    FolderPermission,
    Group,
    Device,
    User,
    UserMapSettings,
    db,
    Link,
    MapShape,
)
from utils.logger import api_logger, main_logger
from services.db.map_repository import map_repo
from services import (
    link_service,
    group_service,
    shape_service,
    map_import_export_service,
)

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
    link = db.session.get(Link, link_id)
    if not link:
        raise ValueError(f"Link with id {link_id} not found")
    return link


def invalidate_sidebar_cache(user_id: int) -> None:
    """Удалить кэшированные данные сайдбара (плоский список и дерево папок) для пользователя."""
    for cache_key in (f"sidebar_{user_id}", f"sidebar_tree_{user_id}"):
        if cache_key in sidebar_cache:
            del sidebar_cache[cache_key]
    main_logger.debug(f"Sidebar cache invalidated for user {user_id}")


def invalidate_all_sidebar_caches() -> None:
    """
    Сбросить кэш сайдбара сразу для ВСЕХ пользователей.

    Используется для операций над папками (создание/переименование/
    перемещение/удаление, выдача/отзыв прав на папку) — такая операция может
    затронуть видимость дерева сразу у нескольких пользователей одновременно
    (не только у владельца папки), а точечная инвалидация по user_id для
    этого не годится. TTL кэша и так всего 10 секунд, поэтому полный сброс
    здесь дешевле и надёжнее, чем вычислять точный список задетых
    пользователей.
    """
    sidebar_cache.clear()
    main_logger.debug("Sidebar cache fully invalidated (folder tree change)")


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


def _sort_key(item: Dict[str, Any]):
    # (position, id) — ties по id сохраняют порядок создания для нетронутых
    # drag-and-drop'ом элементов (у всех position=0 по умолчанию).
    return (item.get("position", 0), item["id"])


def _folder_map_dict(m: Map, stat_dict: Dict[int, int]) -> Dict[str, Any]:
    return {
        "id": m.id,
        "type": "map",
        "name": m.name,
        "owner_id": m.owner_id,
        "position": m.position,
        "down_count": stat_dict.get(m.id, 0),
    }


def _build_folder_node(
    folder: MapFolder,
    visible_map_ids: set,
    fully_granted_ids: set,
    stat_dict: Dict[int, int],
    ancestor_fully_granted: bool,
) -> Optional[Dict[str, Any]]:
    """
    Рекурсивно собрать узел дерева для одной папки.

    fully_granted_ids — папки, на которые у пользователя есть ПРЯМОЕ право
    (владелец/личное разрешение) или которые видны целиком по другой причине
    (админ/оператор — см. get_sidebar_tree_data). Право на папку
    распространяется на ВСЁ её содержимое, включая подпапки, поэтому
    ancestor_fully_granted "протаскивается" вниз по рекурсии: если хотя бы
    один из предков этой папки полностью открыт, вся ветка ниже — тоже.

    Если папка НЕ полностью открыта (доступ появился только благодаря
    персональному разрешению на какую-то карту глубоко внутри), показываем
    только те карты/подпапки, что реально видны — а не всё содержимое.
    Пустые (для этого пользователя) ветки не рендерим вовсе.
    """
    fully_granted_here = ancestor_fully_granted or folder.id in fully_granted_ids

    child_folder_nodes = []
    for child in folder.children:
        node = _build_folder_node(
            child, visible_map_ids, fully_granted_ids, stat_dict, fully_granted_here
        )
        if node is not None:
            child_folder_nodes.append(node)

    if fully_granted_here:
        child_maps = folder.maps.all()
    else:
        child_maps = [m for m in folder.maps.all() if m.id in visible_map_ids]

    if not fully_granted_here and not child_folder_nodes and not child_maps:
        return None  # ветка полностью не видна этому пользователю

    map_dicts = [_folder_map_dict(m, stat_dict) for m in child_maps]
    down_count = sum(m["down_count"] for m in map_dicts) + sum(
        f["down_count"] for f in child_folder_nodes
    )
    # Единый список: папки и карты вперемешку, в порядке (position, id) —
    # так карта может оказаться выше папки на том же уровне (и наоборот),
    # если пользователь перетащил её туда через drag-and-drop.
    children = sorted(child_folder_nodes + map_dicts, key=_sort_key)

    return {
        "id": folder.id,
        "name": folder.name,
        "type": "folder",
        "owner_id": folder.owner_id,
        "position": folder.position,
        "children": children,
        "down_count": down_count,
    }


def get_sidebar_tree_data(user) -> Dict[str, Any]:
    """
    Собрать дерево папок/карт для сайдбара, отфильтрованное по видимости для
    пользователя.

    Права распространяются на всё содержимое папки (в т.ч. вложенные
    подпапки) — см. FolderPermission и services/permissions.py. Дизайн-
    решение: если у пользователя есть доступ ТОЛЬКО к отдельной карте
    глубоко внутри чужой папки (через персональный MapPermission, а не через
    право на саму папку), в дереве всё равно показывается полный путь папок
    до неё (имена родительских папок), просто без доступа к их прочему
    содержимому — как «путь к файлу» в файловом менеджере. Полностью скрыть
    цепочку папок в этом случае можно, но это усложнило бы навигацию сильнее,
    чем оправдывает утечка одних только НАЗВАНИЙ папок.

    Порядок элементов (position) — общий на всех, кто видит данный уровень
    дерева, а не персональный на пользователя: как и is_locked/группы, это
    глобальное состояние карты/папки, а не привязанная к пользователю
    настройка. Если два человека с правами на одну и ту же папку оба таскают
    её содержимое — они видят порядок друг друга.

    Returns:
        Dict: {"id": None, "children": [...карты и папки верхнего уровня,
               в едином порядке...]}
    """
    cache_key = f"sidebar_tree_{user.id}"
    if cache_key in sidebar_cache:
        main_logger.debug(f"Sidebar tree cache hit for user {user.id}")
        return sidebar_cache[cache_key]

    visible_maps = get_available_maps(user)
    visible_map_ids = {m.id for m in visible_maps}

    if visible_maps:
        stats = (
            db.session.query(Device.map_id, func.count(Device.id).label("down_count"))
            .filter(
                Device.map_id.in_(list(visible_map_ids)),
                Device.monitoring_enabled,
                Device.status != "up",
            )
            .group_by(Device.map_id)
            .all()
        )
        stat_dict = {stat[0]: stat[1] for stat in stats}
    else:
        stat_dict = {}

    if user.is_admin or user.is_operator:
        # Админ/оператор видят дерево целиком — как и в get_available_maps().
        fully_granted_ids = {f.id for f in MapFolder.query.all()}
    else:
        owned_ids = {f.id for f in MapFolder.query.filter_by(owner_id=user.id).all()}
        permitted_ids = {
            p.folder_id for p in FolderPermission.query.filter_by(user_id=user.id).all()
        }
        fully_granted_ids = map_repo.expand_with_descendant_folders(
            owned_ids | permitted_ids
        )

    root_folders = MapFolder.query.filter_by(parent_id=None).all()
    folder_nodes = []
    for f in root_folders:
        node = _build_folder_node(
            f, visible_map_ids, fully_granted_ids, stat_dict, False
        )
        if node is not None:
            folder_nodes.append(node)

    root_maps = [
        _folder_map_dict(m, stat_dict) for m in visible_maps if m.folder_id is None
    ]

    children = sorted(folder_nodes + root_maps, key=_sort_key)

    result = {"id": None, "children": children}
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

    # Рекурсивная проверка видимости групп (с устройствами у потомков)
    def group_visible_recursive(g_id, memo=None):
        if memo is None:
            memo = {}
        if g_id in memo:
            return memo[g_id]

        if g_id in group_ids_with_devices:
            memo[g_id] = True
            return True

        children = Group.query.filter_by(parent_group_id=g_id).all()
        has_visible_child = any(group_visible_recursive(c.id, memo) for c in children)
        memo[g_id] = has_visible_child
        return has_visible_child

    visible_group_memo = {}
    visible_groups = {gid for gid in group_ids_with_devices}
    for g in groups:
        if g.id not in visible_group_memo:
            group_visible_recursive(g.id, visible_group_memo)
        if visible_group_memo.get(g.id, False):
            visible_groups.add(g.id)

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

    # Формирование групп (только видимые + parent_group_id)
    groups_out = [
        {
            "id": g.id,
            "name": g.name,
            "color": g.color,
            "font_size": g.font_size,
            "parent_group_id": g.parent_group_id,
        }
        for g in groups
        if g.id in visible_groups
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
            "parent_group_id": g.parent_group_id,
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
