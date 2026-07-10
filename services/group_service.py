"""
Сервис для работы с группами (Groups).
"""

from models import Group, Device, db
from utils.logger import api_logger


def get_group_by_id(group_id: int):
    """Получить группу по ID или вернуть None."""
    return db.session.get(Group, group_id)


def create_group(
    map_id: int, name: str, color: str = "#3498db", font_size: int = 11
) -> Group:
    """Создать группу."""
    group = Group(name=name, color=color, map_id=map_id, font_size=font_size)
    db.session.add(group)
    db.session.commit()
    api_logger.info(f"Group created: ID={group.id}, name={group.name}, map={map_id}")

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(map_id)
    api_logger.info(f"Invalidated cache for map {map_id}")

    return group


def update_group(
    group_id: int,
    name: str = None,
    color: str = None,
    font_size: int = None,
) -> Group:
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

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(group.map_id)
    api_logger.info(f"  🗑️ Invalidated cache for map {group.map_id}")

    return group


def delete_group(group_id: int) -> int:
    """Удалить группу (устройства остаются без группы)."""
    group = Group.query.get_or_404(group_id)
    map_id = group.map_id
    Device.query.filter_by(group_id=group_id).update({"group_id": None})
    db.session.delete(group)
    db.session.commit()
    api_logger.info(f"Group deleted: ID={group_id}")

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(map_id)
    api_logger.info(f"Invalidated cache for map {map_id}")

    return group_id
