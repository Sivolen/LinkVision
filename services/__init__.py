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
from . import audit_service
from . import security_service

from . import permission_service

# Экспорт для удобного использования
from .permission_service import (
    grant_map_permission,
    grant_map_role_permission,
    update_map_permission_role,
    revoke_map_permission,
)
from .map_service import (
    invalidate_sidebar_cache,
    invalidate_groups_cache,
    toggle_map_lock,
)
from .user_service import (
    update_last_map_id,
    change_user_password,
)
from .device_type_service import get_cached_types, invalidate_types_cache
from .permissions import (
    has_map_access,
    has_device_access,
    can_view_map,
    can_edit_map,
    can_edit_device,
    can_delete_map,
    require_map_access,
    require_map_edit,
    require_device_access,
    require_device_edit,
    require_admin,
    require_not_operator,
    require_map_owner_or_admin,
    get_user_map_ids,
    get_user_editable_map_ids,
)
from .audit_service import (
    log_action,
    log_map_action,
    log_device_action,
    log_permission_action,
    log_auth_action,
    get_audit_logs,
    get_user_activity_summary,
)
from .security_service import (
    rate_limit,
    rate_limiter,
    validate_password_strength,
    validate_password_full,
    check_password_common,
    get_client_ip,
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
    "device_service",
    "map_service",
    "user_service",
    "device_type_service",
    "settings_service",
    "monitor",
    "audit_service",
    "permission_service",
    "invalidate_sidebar_cache",
    "invalidate_groups_cache",
    "toggle_map_lock",
    "update_last_map_id",
    "change_user_password",
    # Типы устройств
    "get_cached_types",
    "invalidate_types_cache",
    # Права доступа
    "has_map_access",
    "has_device_access",
    "can_view_map",
    "can_edit_map",
    "can_edit_device",
    "can_delete_map",
    "require_map_access",
    "require_map_edit",
    "require_device_access",
    "require_device_edit",
    "require_admin",
    "require_not_operator",
    "require_map_owner_or_admin",
    "get_user_map_ids",
    "get_user_editable_map_ids",
    # Аудит
    "log_action",
    "log_map_action",
    "log_device_action",
    "log_permission_action",
    "log_auth_action",
    "get_audit_logs",
    "get_user_activity_summary",
    # Безопасность
    "rate_limit",
    "rate_limiter",
    "validate_password_strength",
    "validate_password_full",
    "check_password_common",
    "get_client_ip",
    # Валидаторы
    "validate_ip_address",
    "validate_ip_list",
    "validate_name",
    "validate_positive_int",
    "validate_float_range",
    "validate_color_hex",
    "validate_line_style",
    "validate_link_type",
]
