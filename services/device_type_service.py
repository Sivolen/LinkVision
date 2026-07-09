"""
Сервис для работы с типами устройств.

Бизнес-логика связанная с типами устройств:
- CRUD операции
- Кэширование
- Управление иконками
"""

import os
from typing import Optional, List, Dict, Any
from cachetools import TTLCache

from flask import current_app

from models import DeviceType, db
from utils.file_validation import safe_save_upload
from utils.logger import admin_logger

# Кэш для типов устройств
_types_cache: TTLCache = TTLCache(maxsize=1, ttl=600)


def get_cached_types() -> List[Dict[str, Any]]:
    """Получить кэшированные типы устройств."""
    if "types" not in _types_cache:
        types = DeviceType.query.all()
        _types_cache["types"] = [
            {"id": t.id, "name": t.name, "width": t.width, "height": t.height}
            for t in types
        ]
    return _types_cache["types"]


def invalidate_types_cache() -> None:
    """Очистить кэш типов устройств."""
    _types_cache.pop("types", None)


def get_all_device_types() -> List[DeviceType]:
    """Получить все типы устройств."""
    return DeviceType.query.all()


def get_device_type_by_id(type_id: int) -> Optional[DeviceType]:
    """Получить тип устройства по ID."""
    return db.session.get(DeviceType, type_id)


def create_device_type(
    name: str, width: Optional[int] = None, height: Optional[int] = None, icon_file=None
) -> DeviceType:
    """
    Создать тип устройства.

    Args:
        name: Название типа
        width: Ширина иконки
        height: Высота иконки
        icon_file: Файл иконки

    Returns:
        DeviceType: Созданный тип устройства
    """
    filename = None
    if icon_file and icon_file.filename:
        upload_folder = current_app.config["UPLOAD_FOLDER"]
        saved_name = safe_save_upload(icon_file, upload_folder)
        if saved_name:
            filename = saved_name
        else:
            raise ValueError("Недопустимый файл иконки")

    dtype = DeviceType(
        name=name,
        icon_filename=filename,
        width=int(width) if width else None,
        height=int(height) if height else None,
    )
    db.session.add(dtype)
    db.session.commit()
    admin_logger.info(f"Device type created: {name}")
    return dtype


def update_device_type(
    type_id: int,
    name: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    icon_file=None,
) -> DeviceType:
    """
    Обновить тип устройства.

    Args:
        type_id: ID типа
        name: Новое название
        width: Новая ширина
        height: Новая высота
        icon_file: Новый файл иконки

    Returns:
        DeviceType: Обновленный тип
    """
    dtype = DeviceType.query.get_or_404(type_id)
    if name is not None:
        dtype.name = name
    dtype.width = int(width) if width else None
    dtype.height = int(height) if height else None

    if icon_file and icon_file.filename:
        # Удаляем старую иконку
        if dtype.icon_filename:
            old_path = os.path.join(
                current_app.config["UPLOAD_FOLDER"], dtype.icon_filename
            )
            if os.path.exists(old_path):
                os.remove(old_path)
        # Сохраняем новую
        saved_name = safe_save_upload(icon_file, current_app.config["UPLOAD_FOLDER"])
        if saved_name:
            dtype.icon_filename = saved_name
        else:
            raise ValueError("Недопустимый файл иконки")

    db.session.commit()
    admin_logger.info(f"Device type updated: ID={type_id}")
    return dtype


def delete_device_type(type_id: int) -> int:
    """
    Удалить тип устройства и его иконку.

    Args:
        type_id: ID типа

    Returns:
        int: ID удаленного типа
    """
    dtype = DeviceType.query.get_or_404(type_id)
    if dtype.icon_filename:
        icon_path = os.path.join(
            current_app.config["UPLOAD_FOLDER"], dtype.icon_filename
        )
        if os.path.exists(icon_path):
            os.remove(icon_path)
    db.session.delete(dtype)
    db.session.commit()
    admin_logger.info(f"Device type deleted: ID={type_id}")
    return type_id
