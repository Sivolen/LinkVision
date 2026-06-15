"""
База данных репозиториев.

Экспортирует все репозитории для удобного импорта.
"""

from services.db.device_repository import DeviceRepository, device_repo
from services.db.map_repository import MapRepository, map_repo

__all__ = [
    "DeviceRepository",
    "device_repo",
    "MapRepository",
    "map_repo",
]
