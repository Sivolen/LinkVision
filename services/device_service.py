"""
Сервис для работы с устройствами.

Бизнес-логика связанная с устройствами:
- Создание, обновление, удаление
- Валидация данных
- История изменений
"""

from typing import Optional, List, Dict, Any
import datetime

from sqlalchemy.exc import IntegrityError

from models import Device, DeviceIP, DeviceHistory, db, DeviceType, Group, Map
from utils.logger import api_logger
from services.validators import validate_ip_list
from services.db.device_repository import device_repo


def validate_device_type(type_id: int) -> DeviceType:
    """
    Проверить существование типа устройства.

    Args:
        type_id: ID типа устройства

    Returns:
        DeviceType: Объект типа

    Raises:
        ValueError: Если тип не найден
    """
    dtype = db.session.get(DeviceType, type_id)
    if not dtype:
        raise ValueError(f"Device type with id {type_id} not found")
    return dtype


def validate_group_for_map(group_id: Optional[int], map_id: int) -> Optional[Group]:
    """
    Проверить принадлежность группы к карте.

    Args:
        group_id: ID группы
        map_id: ID карты

    Returns:
        Optional[Group]: Объект группы или None

    Raises:
        ValueError: Если группа не найдена или не принадлежит карте
    """
    if group_id is None:
        return None

    group = db.session.get(Group, group_id)
    if not group:
        raise ValueError(f"Group with id {group_id} not found")
    if group.map_id != map_id:
        raise ValueError(f"Group {group_id} does not belong to map {map_id}")
    return group


def get_device_by_id(device_id: int) -> Optional[Device]:
    """Получить устройство по ID."""
    return device_repo.get_by_id(device_id)


def get_device_history(
    device_id: int, page: int = 1, per_page: int = 10
) -> Dict[str, Any]:
    """
    Получить историю изменений устройства.

    Args:
        device_id: ID устройства
        page: Номер страницы
        per_page: Количество записей на странице

    Returns:
        Dict с пагинированной историей
    """
    query = DeviceHistory.query.filter_by(device_id=device_id).order_by(
        DeviceHistory.timestamp.desc()
    )
    total = query.count()
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    items = [
        {
            "id": h.id,
            "old_status": h.old_status,
            "new_status": h.new_status,
            "timestamp": h.timestamp.isoformat(),
        }
        for h in paginated.items
    ]

    return {
        "items": items,
        "page": page,
        "pages": paginated.pages,
        "total": total,
        "per_page": per_page,
    }


def get_device_details(device_id: int) -> Dict[str, Any]:
    """
    Получить детальную информацию об устройстве.

    Args:
        device_id: ID устройства

    Returns:
        Dict с полной информацией об устройстве
    """
    device = Device.query.get_or_404(device_id)
    history = get_device_history(device_id)
    neighbors = []

    for link in device.source_links:
        neighbor = link.target
        if neighbor:
            neighbors.append(
                {
                    "device_id": neighbor.id,
                    "device_name": neighbor.name,
                    "interface": link.source_interface,
                    "neighbor_interface": link.target_interface,
                    "link_type": link.link_type,
                    "color": link.line_color,
                    "width": link.line_width,
                    "style": link.line_style,
                }
            )

    for link in device.target_links:
        neighbor = link.source
        if neighbor:
            neighbors.append(
                {
                    "device_id": neighbor.id,
                    "device_name": neighbor.name,
                    "interface": link.target_interface,
                    "neighbor_interface": link.source_interface,
                    "link_type": link.link_type,
                    "color": link.line_color,
                    "width": link.line_width,
                    "style": link.line_style,
                }
            )

    return {
        "id": device.id,
        "name": device.name,
        "ips": [ip.ip_address for ip in device.ips],
        "type_id": device.type_id,
        "type_name": device.type.name if device.type else None,
        "pos_x": device.pos_x,
        "pos_y": device.pos_y,
        "status": device.status,
        "last_check": device.last_check.isoformat() if device.last_check else None,
        "map_id": device.map_id,
        "group_id": device.group_id,
        "monitoring_enabled": device.monitoring_enabled,
        "history": history,
        "neighbors": neighbors,
    }


def create_device(
    map_id: int,
    type_id: int,
    name: str,
    ips: Optional[List[str]] = None,
    x: float = 100,
    y: float = 100,
    group_id: Optional[int] = None,
    monitoring_enabled: bool = True,
    font_size: Optional[int] = None,
) -> Device:
    """
    Создать новое устройство.

    Args:
        map_id: ID карты
        type_id: ID типа устройства
        name: Название устройства
        ips: Список IP-адресов
        x: Позиция X
        y: Позиция Y
        group_id: ID группы
        monitoring_enabled: Включить мониторинг
        font_size: Размер шрифта

    Returns:
        Device: Созданное устройство

    Raises:
        ValueError: Если валидация не пройдена
    """
    # Проверяем существование карты и типа
    map_obj = db.session.get(Map, map_id)
    if not map_obj:
        raise ValueError(f"Карта с id {map_id} не найдена")

    type_obj = db.session.get(DeviceType, type_id)
    if not type_obj:
        raise ValueError(f"Тип устройства с id {type_id} не найден")

    try:
        device = Device(
            map_id=map_id,
            type_id=type_id,
            name=name,
            font_size=font_size,
            pos_x=x,
            pos_y=y,
            group_id=group_id if group_id and group_id > 0 else None,
            monitoring_enabled=monitoring_enabled,
            status="up",
        )
        db.session.add(device)
        db.session.commit()

        if ips and isinstance(ips, list):
            seen = set()
            for ip in ips:
                if ip and isinstance(ip, str):
                    ip_clean = ip.strip()
                    if ip_clean and ip_clean not in seen:
                        db.session.add(
                            DeviceIP(device_id=device.id, ip_address=ip_clean)
                        )
                        seen.add(ip_clean)
            db.session.commit()

        api_logger.info(
            f"Device created: ID={device.id}, name={device.name}, ips={ips}"
        )

        # Инвалидируем кэш элементов карты
        from .map_service import invalidate_map_elements_cache
        invalidate_map_elements_cache(map_id)
        api_logger.info(f"Invalidated cache for map {map_id}")

        return device

    except IntegrityError as e:
        db.session.rollback()
        api_logger.error(f"Integrity error creating device: {e}")
        raise ValueError(
            "Не удалось создать устройство: нарушение ссылочной целостности. "
            "Проверьте map_id и type_id."
        )
    except Exception as e:
        db.session.rollback()
        api_logger.error(f"Error creating device: {e}")
        raise


def update_device(device_id: int, **kwargs: Any) -> Device:
    """
    Обновить устройство.

    Args:
        device_id: ID устройства
        **kwargs: Поля для обновления

    Returns:
        Device: Обновленное устройство
    """
    device = Device.query.get_or_404(device_id)
    allowed_fields = [
        "name",
        "type_id",
        "pos_x",
        "pos_y",
        "group_id",
        "monitoring_enabled",
        "font_size",
    ]

    for key, value in kwargs.items():
        if key in allowed_fields:
            setattr(device, key, value)

    # Если мониторинг был выключен, а теперь включён – сбрасываем статус на 'up'
    if "monitoring_enabled" in kwargs and kwargs["monitoring_enabled"] is True:
        device.status = "up"
        device.last_check = datetime.datetime.now()

    if "ips" in kwargs:
        new_ips = kwargs["ips"]
        if new_ips is not None and isinstance(new_ips, list):
            # Валидация и дедупликация
            clean_new, error = validate_ip_list(new_ips)
            if error:
                raise ValueError(error)

            # Существующие IP
            existing_set = {ip.ip_address for ip in device.ips}

            # Удаляем IP, которых нет в новом списке
            for ip_obj in device.ips[:]:
                if ip_obj.ip_address not in clean_new:
                    db.session.delete(ip_obj)

            # Добавляем новые IP
            for ip_str in clean_new:
                if ip_str not in existing_set:
                    db.session.add(DeviceIP(device_id=device.id, ip_address=ip_str))
        else:
            # Если new_ips = None или не список – удаляем все IP
            for ip_obj in device.ips[:]:
                db.session.delete(ip_obj)

    db.session.commit()
    api_logger.info(f"Device updated: ID={device_id}")

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(device.map_id)
    api_logger.info(f"  🗑️ Invalidated cache for map {device.map_id}")

    return device


def delete_device(device_id: int) -> None:
    """Удалить устройство."""
    device = Device.query.get_or_404(device_id)
    map_id = device.map_id
    db.session.delete(device)
    db.session.commit()
    api_logger.info(f"Device deleted: ID={device_id}")

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(map_id)
    api_logger.info(f"Invalidated cache for map {map_id}")


def update_device_position(device_id: int, x: float, y: float) -> Device:
    """Обновить позицию устройства."""
    device = Device.query.get_or_404(device_id)
    device.pos_x = x
    device.pos_y = y
    db.session.commit()
    api_logger.info(f"Device position updated: ID={device_id} -> ({x}, {y})")

    # Инвалидируем кэш элементов карты
    from .map_service import invalidate_map_elements_cache
    invalidate_map_elements_cache(device.map_id)
    api_logger.info(f"  🗑️ Invalidated cache for map {device.map_id}")

    return device


def get_all_device_types():
    """Получить все типы устройств."""
    return DeviceType.query.all()


def update_devices_positions(updates: List[Dict[str, Any]]) -> int:
    """Массовое обновление позиций."""
    from .map_service import invalidate_map_elements_cache

    map_ids = set()
    for update in updates:
        device = db.session.get(Device, update["id"])
        if device:
            device.pos_x = update["x"]
            device.pos_y = update["y"]
            map_ids.add(device.map_id)

    db.session.commit()

    # Инвалидируем кэш для всех затронутых карт
    for map_id in map_ids:
        invalidate_map_elements_cache(map_id)
        api_logger.info(f"Invalidated cache for map {map_id}")

    return len(updates)


# Кэш для типов устройств вынесен в device_type_service
