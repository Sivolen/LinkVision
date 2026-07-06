"""
Сервис для работы со связями (Links).
"""

from models import Link, db
from utils.logger import api_logger


def get_link_by_id(link_id: int):
    """Получить связь по ID или вернуть None."""
    return Link.query.get(link_id)


def create_link(
    map_id: int,
    source_id: int,
    target_id: int,
    src_iface: str = "eth0",
    tgt_iface: str = "eth0",
    link_type: str = None,
    line_color: str = "#6c757d",
    line_width: int = 2,
    line_style: str = "solid",
    font_size: int = 8,
) -> Link:
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

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(map_id)
    api_logger.info(f"  🗑️ Invalidated cache for map {map_id}")

    return link


def update_link(link_id: int, **kwargs) -> Link:
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

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(link.map_id)
    api_logger.info(f"  🗑️ Invalidated cache for map {link.map_id}")

    return link


def delete_link(link_id: int) -> int:
    """Удалить связь."""
    link = Link.query.get_or_404(link_id)
    map_id = link.map_id
    db.session.delete(link)
    db.session.commit()
    api_logger.info(f"Link deleted: ID={link_id}")

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(map_id)
    api_logger.info(f"  🗑️ Invalidated cache for map {map_id}")

    return link_id
