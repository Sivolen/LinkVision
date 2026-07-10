"""
Сервис для работы с фигурами (Shapes).
"""

from models import MapShape, db
from utils.logger import api_logger


def get_map_shapes(map_id: int):
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
    description: str = None,
    font_size: int = 12,
) -> MapShape:
    """Создать фигуру на карте."""
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

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(map_id)
    api_logger.info(f"Invalidated cache for map {map_id}")

    return shape


def update_shape(shape_id: int, **kwargs) -> MapShape:
    """Обновить фигуру."""
    shape = MapShape.query.get_or_404(shape_id)

    api_logger.info(f"update_shape called: shape_id={shape_id}, kwargs={kwargs}")

    if "font_size" in kwargs:
        shape.font_size = kwargs["font_size"]

    for key, value in kwargs.items():
        if hasattr(shape, key) and value is not None:
            old_value = getattr(shape, key)
            setattr(shape, key, value)
            if key in ["x", "y"]:
                api_logger.info(f"  Updating {key}: {old_value} -> {value}")

    db.session.commit()

    api_logger.info(f"Shape saved: x={shape.x}, y={shape.y}")

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(shape.map_id)
    api_logger.info(f"  🗑️ Invalidated cache for map {shape.map_id}")

    return shape


def delete_shape(shape_id: int) -> None:
    """Удалить фигуру."""
    shape = MapShape.query.get_or_404(shape_id)
    map_id = shape.map_id
    db.session.delete(shape)
    db.session.commit()

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(map_id)
    api_logger.info(f"Invalidated cache for map {map_id}")
