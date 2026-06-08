"""
Пакет сервисов LinkVision.

Содержит бизнес-логику приложения:
- device_service: работа с устройствами
- map_service: работа с картами
- user_service: работа с пользователями
- device_type_service: типы устройств
- settings_service: настройки
- permissions: проверки прав доступа
- validators: валидация данных
- monitor: мониторинг устройств
"""

from . import device_service
from . import map_service
from . import user_service
from . import device_type_service
from . import settings_service
from . import monitor

# Экспорт для удобного использования
from .device_type_service import get_cached_types, invalidate_types_cache
from .permissions import (
    has_map_access,
    has_device_access,
    require_map_access,
    require_device_access,
    require_admin,
    require_not_operator,
    get_user_map_ids,
    can_edit_map,
    can_delete_map,
)
from .validators import (
    validate_ip_address,
    validate_ip_list,
    validate_name,
    validate_positive_int,
    validate_float_range,
    validate_color_hex,
    validate_line_style,
    validate_link_type,
)

__all__ = [
    # Сервисы
    'device_service',
    'map_service',
    'user_service',
    'device_type_service',
    'settings_service',
    'monitor',

    # Типы устройств
    'get_cached_types',
    'invalidate_types_cache',

    # Права доступа
    'has_map_access',
    'has_device_access',
    'require_map_access',
    'require_device_access',
    'require_admin',
    'require_not_operator',
    'get_user_map_ids',
    'can_edit_map',
    'can_delete_map',

    # Валидаторы
    'validate_ip_address',
    'validate_ip_list',
    'validate_name',
    'validate_positive_int',
    'validate_float_range',
    'validate_color_hex',
    'validate_line_style',
    'validate_link_type',
]

