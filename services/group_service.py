"""
Сервис для работы с группами (Groups).
"""

from models import Group, Device, db
from utils.logger import api_logger

_UNSET = object()


def get_group_by_id(group_id: int):
    """Получить группу по ID или вернуть None."""
    return db.session.get(Group, group_id)


def would_create_cycle(group_id: int, new_parent_id: int) -> bool:
    """Проверяет, создаст ли назначение new_parent_id для group_id цикл."""
    if not new_parent_id or new_parent_id == group_id:
        return False
    visited = set()
    current = new_parent_id
    while current:
        if current == group_id:
            return True
        if current in visited:
            break
        visited.add(current)
        g = db.session.get(Group, current)
        if not g:
            break
        current = g.parent_group_id
    return False


def create_group(
    map_id: int, name: str, color: str = "#3498db", font_size: int = 11, parent_group_id: int = None
) -> Group:
    """Создать группу."""
    if parent_group_id is not None:
        parent = db.session.get(Group, parent_group_id)
        if not parent or parent.map_id != map_id:
            raise ValueError("Родительская группа не найдена или не принадлежит этой карте")
        if would_create_cycle(parent_group_id, parent_group_id):
            raise ValueError("Нельзя создать цикл вложенности")

    group = Group(name=name, color=color, map_id=map_id, font_size=font_size, parent_group_id=parent_group_id)
    db.session.add(group)
    db.session.commit()
    api_logger.info(f"Group created: ID={group.id}, name={group.name}, map={map_id}")

    # Инвалидируем кэш элементов карты.
    # Импорт ЗДЕСЬ, а не наверху файла — это настоящий, необходимый обход
    # циклического импорта: map_service.py сам импортирует этот модуль
    # (через "from services import (..., link_service, group_service,
    # shape_service, ...)" — см. map_service.py) для построения общего
    # фасада services.*. Если поднять этот импорт на верхний уровень файла,
    # получится ImportError: cannot import name ... from partially
    # initialized module 'services.map_service' — проверено, воспроизводится.
    from .map_service import invalidate_map_elements_cache

    invalidate_map_elements_cache(map_id)
    api_logger.info(f"Invalidated cache for map {map_id}")

    return group


def update_group(
    group_id: int,
    name: str = None,
    color: str = None,
    font_size: int = None,
    parent_group_id: object = _UNSET,
) -> Group:
    """Обновить группу."""
    group = db.session.get(Group, group_id)
    if not group:
        raise ValueError("Группа не найдена")

    if name is not None:
        group.name = name
    if color is not None:
        group.color = color
    if font_size is not None:
        group.font_size = font_size
        
    if parent_group_id is not _UNSET:
        # Сохраняем старый map_id до изменения родителя
        old_map_id = group.map_id
        group.parent_group_id = parent_group_id
        
        if parent_group_id is not None:
            parent = db.session.get(Group, parent_group_id)
            if not parent:
                group.parent_group_id = None # Откат в случае ошибки
                raise ValueError("Родительская группа не найдена")
            if parent.map_id != old_map_id:
                group.parent_group_id = None # Откат
                raise ValueError("Родительская группа принадлежит другой карте")
            if would_create_cycle(group_id, parent_group_id):
                group.parent_group_id = None # Откат
                raise ValueError("Нельзя создать цикл вложенности")

    db.session.commit()
    api_logger.info(f"Group updated: ID={group_id}")

    # Инвалидируем кэш элементов карты.
    # Импорт ЗДЕСЬ, а не наверху файла — это настоящий, необходимый обход
    # циклического импорта: map_service.py сам импортирует этот модуль
    # (через "from services import (..., link_service, group_service,
    # shape_service, ...)" — см. map_service.py) для построения общего
    # фасада services.*. Если поднять этот импорт на верхний уровень файла,
    # получится ImportError: cannot import name ... from partially
    # initialized module 'services.map_service' — проверено, воспроизводится.
    from .map_service import invalidate_map_elements_cache

    invalidate_map_elements_cache(group.map_id)
    api_logger.info(f"  🗑️ Invalidated cache for map {group.map_id}")

    return group


def delete_group(group_id: int) -> int:
    """Удалить группу (устройства остаются без группы, дочерние группы реродительствуются)."""
    group = db.session.get(Group, group_id)
    if not group:
        raise ValueError("Группа не найдена")
        
    map_id = group.map_id
    
    # Реродительство дочерних групп на уровень выше
    children = Group.query.filter_by(parent_group_id=group_id).all()
    for child in children:
        child.parent_group_id = group.parent_group_id
        
    # Освобождаем устройства от группы
    Device.query.filter_by(group_id=group_id).update({"group_id": None})
    
    db.session.delete(group)
    db.session.commit()
    api_logger.info(f"Group deleted: ID={group_id}")

    # Инвалидируем кэш элементов карты.
    # Импорт ЗДЕСЬ, а не наверху файла — это настоящий, необходимый обход
    # циклического импорта: map_service.py сам импортирует этот модуль
    # (через "from services import (..., link_service, group_service,
    # shape_service, ...)" — см. map_service.py) для построения общего
    # фасада services.*. Если поднять этот импорт на верхний уровень файла,
    # получится ImportError: cannot import name ... from partially
    # initialized module 'services.map_service' — проверено, воспроизводится.
    from .map_service import invalidate_map_elements_cache

    invalidate_map_elements_cache(map_id)
    api_logger.info(f"Invalidated cache for map {map_id}")

    return group_id
