"""
Репозиторий для работы с устройствами.

Инкапсулирует все SQL-запросы к таблице Device.
"""

from typing import List, Optional, Dict, Any
import datetime
from sqlalchemy.orm import joinedload
from extensions import db
from models import Device, DeviceIP, DeviceHistory


class DeviceRepository:
    """Репозиторий для работы с устройствами."""

    @staticmethod
    def get_by_id(device_id: int) -> Optional[Device]:
        """
        Получить устройство по ID.

        Args:
            device_id: ID устройства

        Returns:
            Optional[Device]: Устройство или None
        """
        return db.session.get(Device, device_id)

    @staticmethod
    def get_with_relations(device_id: int) -> Optional[Device]:
        """
        Получить устройство с подгрузкой отношений.

        Args:
            device_id: ID устройства

        Returns:
            Optional[Device]: Устройство с relations или None
        """
        return db.session.get(
            Device,
            device_id,
            options=[
                joinedload(Device.type),
                joinedload(Device.ips),
                joinedload(Device.group),
            ],
        )

    @staticmethod
    def get_by_map(map_id: int) -> List[Device]:
        """
        Получить все устройства карты.

        Args:
            map_id: ID карты

        Returns:
            List[Device]: Список устройств
        """
        return Device.query.filter_by(map_id=map_id).all()

    @staticmethod
    def get_by_map_with_relations(map_id: int) -> List[Device]:
        """
        Получить все устройства карты с подгрузкой отношений.

        Args:
            map_id: ID карты

        Returns:
            List[Device]: Список устройств с relations
        """
        return (
            Device.query.options(joinedload(Device.type), joinedload(Device.ips))
            .filter_by(map_id=map_id)
            .all()
        )

    @staticmethod
    def get_monitoring_enabled() -> List[Device]:
        """
        Получить устройства с включенным мониторингом.

        Returns:
            List[Device]: Список устройств
        """
        return Device.query.filter_by(monitoring_enabled=True).all()

    @staticmethod
    def get_down_devices(map_id: Optional[int] = None) -> List[Device]:
        """
        Получить недоступные устройства.

        Args:
            map_id: Опционально ID карты для фильтрации

        Returns:
            List[Device]: Список недоступных устройств
        """
        query = Device.query.filter(
            Device.monitoring_enabled == True, Device.status != "up"
        )

        if map_id:
            query = query.filter_by(map_id=map_id)

        return query.all()

    @staticmethod
    def create(
        map_id: int,
        type_id: int,
        name: str,
        pos_x: float = 100,
        pos_y: float = 100,
        group_id: Optional[int] = None,
        monitoring_enabled: bool = True,
        font_size: Optional[int] = None,
    ) -> Device:
        """
        Создать устройство.

        Args:
            map_id: ID карты
            type_id: ID типа устройства
            name: Название
            pos_x: Позиция X
            pos_y: Позиция Y
            group_id: ID группы
            monitoring_enabled: Включить мониторинг
            font_size: Размер шрифта

        Returns:
            Device: Созданное устройство
        """
        device = Device(
            map_id=map_id,
            type_id=type_id,
            name=name,
            pos_x=pos_x,
            pos_y=pos_y,
            group_id=group_id if group_id and group_id > 0 else None,
            monitoring_enabled=monitoring_enabled,
            font_size=font_size,
            status="up",
        )
        db.session.add(device)
        db.session.commit()
        return device

    @staticmethod
    def update_position(device_id: int, x: float, y: float) -> Optional[Device]:
        """
        Обновить позицию устройства.

        Args:
            device_id: ID устройства
            x: Новая позиция X
            y: Новая позиция Y

        Returns:
            Optional[Device]: Обновленное устройство или None
        """
        device = db.session.get(Device, device_id)
        if not device:
            return None

        device.pos_x = x
        device.pos_y = y
        db.session.commit()
        return device

    @staticmethod
    def update_positions(updates: List[Dict[str, Any]]) -> int:
        """
        Массовое обновление позиций.

        Args:
            updates: Список обновлений [{'id': int, 'x': float, 'y': float}]

        Returns:
            int: Количество обновленных устройств
        """
        if not updates:
            return 0

        updated = 0
        for item in updates:
            device = db.session.get(Device, item.get("id"))
            if device:
                device.pos_x = item.get("x", device.pos_x)
                device.pos_y = item.get("y", device.pos_y)
                updated += 1

        db.session.commit()
        return updated

    @staticmethod
    def update_status(device_id: int, status: str) -> Optional[Device]:
        """
        Обновить статус устройства.

        Args:
            device_id: ID устройства
            status: Новый статус

        Returns:
            Optional[Device]: Обновленное устройство или None
        """
        device = db.session.get(Device, device_id)
        if not device:
            return None

        device.status = status
        device.last_check = datetime.datetime.now()
        db.session.commit()
        return device

    @staticmethod
    def delete(device_id: int) -> bool:
        """
        Удалить устройство.

        Args:
            device_id: ID устройства

        Returns:
            bool: True если удалено
        """
        device = db.session.get(Device, device_id)
        if not device:
            return False

        db.session.delete(device)
        db.session.commit()
        return True

    @staticmethod
    def count_by_map(map_id: int) -> int:
        """
        Посчитать количество устройств на карте.

        Args:
            map_id: ID карты

        Returns:
            int: Количество устройств
        """
        return Device.query.filter_by(map_id=map_id).count()

    @staticmethod
    def count_down_by_map(map_id: int) -> int:
        """
        Посчитать количество недоступных устройств на карте.

        Args:
            map_id: ID карты

        Returns:
            int: Количество недоступных устройств
        """
        return (
            Device.query.filter_by(map_id=map_id, monitoring_enabled=True)
            .filter(Device.status != "up")
            .count()
        )


# Singleton instance
device_repo = DeviceRepository()
