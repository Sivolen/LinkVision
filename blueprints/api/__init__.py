"""
API Blueprint для LinkVision.

Оптимизированная версия с использованием:
- Декораторов permissions
- Валидаторов
- Сервисов для бизнес-логики
"""

from flask import Blueprint

api_bp = Blueprint("api", __name__, url_prefix="/api")

# Импорт подмодулей (регистрирует роуты)
from . import devices, links, groups, shapes, maps, permissions, audit, folders  # noqa: E402

# Регистрация подблюпринтов
api_bp.register_blueprint(devices.devices_bp)
api_bp.register_blueprint(links.links_bp)
api_bp.register_blueprint(groups.groups_bp)
api_bp.register_blueprint(shapes.shapes_bp)
api_bp.register_blueprint(maps.maps_bp)
api_bp.register_blueprint(permissions.permissions_bp)
api_bp.register_blueprint(audit.audit_bp)
api_bp.register_blueprint(folders.folders_bp)
