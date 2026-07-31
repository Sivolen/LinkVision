from datetime import datetime
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, index=True)
    password_hash = db.Column(db.String(128))
    is_admin = db.Column(db.Boolean, default=False)
    is_operator = db.Column(db.Boolean, default=False)
    must_change_password = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.now)
    last_map_id = db.Column(db.Integer, db.ForeignKey("map.id"), nullable=True)
    locale = db.Column(db.String(8), nullable=True)  # 'ru' / 'en' / None (авто)

    # Явно указываем foreign_keys для связи maps
    maps = db.relationship(
        "Map", backref="owner", lazy="dynamic", foreign_keys="Map.owner_id"
    )
    last_map = db.relationship("Map", foreign_keys=[last_map_id])

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class DeviceType(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64))
    icon_filename = db.Column(db.String(256))
    width = db.Column(db.Integer, nullable=True)  # ширина иконки в пикселях
    height = db.Column(db.Integer, nullable=True)  # высота иконки в пикселях
    devices = db.relationship("Device", backref="type", lazy="dynamic")


class Device(db.Model):
    __tablename__ = "device"
    __table_args__ = (
        db.Index(
            "idx_device_map_monitoring_status", "map_id", "monitoring_enabled", "status"
        ),
        db.Index("idx_device_map_id", "map_id"),
        db.Index("idx_device_status", "status"),
    )
    id = db.Column(db.Integer, primary_key=True)
    map_id = db.Column(db.Integer, db.ForeignKey("map.id"), index=True)
    type_id = db.Column(db.Integer, db.ForeignKey("device_type.id"), index=True)
    name = db.Column(db.String(64))
    ips = db.relationship(
        "DeviceIP", back_populates="device", cascade="all, delete-orphan"
    )
    font_size = db.Column(db.Integer, nullable=True)
    pos_x = db.Column(db.Float, default=0)
    pos_y = db.Column(db.Float, default=0)
    status = db.Column(db.String(10), default="up")
    last_check = db.Column(db.DateTime, default=datetime.now)
    group_id = db.Column(db.Integer, db.ForeignKey("group.id"), index=True)
    monitoring_enabled = db.Column(db.Boolean, default=True)

    source_links = db.relationship(
        "Link",
        foreign_keys="Link.source_device_id",
        backref="source",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )
    target_links = db.relationship(
        "Link",
        foreign_keys="Link.target_device_id",
        backref="target",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )


class DeviceIP(db.Model):
    __tablename__ = "device_ips"
    id = db.Column(db.Integer, primary_key=True)
    device_id = db.Column(
        db.Integer, db.ForeignKey("device.id", ondelete="CASCADE"), nullable=False
    )
    ip_address = db.Column(db.String(45), nullable=False)
    created_at = db.Column(db.DateTime, default=db.func.now())
    device = db.relationship("Device", back_populates="ips")


class Link(db.Model):
    __tablename__ = "link"
    __table_args__ = (db.Index("idx_link_map_id", "map_id"),)
    id = db.Column(db.Integer, primary_key=True)
    map_id = db.Column(db.Integer, db.ForeignKey("map.id"), index=True)
    source_device_id = db.Column(db.Integer, db.ForeignKey("device.id"), index=True)
    target_device_id = db.Column(db.Integer, db.ForeignKey("device.id"), index=True)
    source_interface = db.Column(db.String(32), default="eth0")
    target_interface = db.Column(db.String(32), default="eth0")
    # Новые поля для кастомизации линии
    link_type = db.Column(
        db.String(20), nullable=True
    )  # например: '100m', '1G', 'vlan', 'radio'
    line_color = db.Column(db.String(7), default="#6c757d")  # hex-код цвета
    line_width = db.Column(db.Integer, default=2)  # толщина линии в пикселях
    line_style = db.Column(db.String(10), default="solid")  # solid, dashed, dotted
    font_size = db.Column(db.Integer, default=8)


class Settings(db.Model):
    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.String(256))


class Map(db.Model):
    __table_args__ = {"extend_existing": True}
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128))
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    created_at = db.Column(db.DateTime, default=datetime.now)
    background_image = db.Column(db.String(256), nullable=True)
    is_locked = db.Column(db.Boolean, default=False, nullable=False)  # Блокировка карты
    devices = db.relationship(
        "Device", backref="map", cascade="all, delete-orphan", lazy="dynamic"
    )
    links = db.relationship(
        "Link", backref="map", cascade="all, delete-orphan", lazy="dynamic"
    )


class MapPermission(db.Model):
    """
    Разрешения на карту для пользователей и ролей.

    Позволяет гибко управлять доступом:
    - Владелец карты всегда имеет полный доступ
    - Можно дать доступ конкретному пользователю (user_id)
    - Можно дать доступ всем операторам (role='viewer' или 'editor')
    """

    __tablename__ = "map_permission"
    id = db.Column(db.Integer, primary_key=True)
    map_id = db.Column(
        db.Integer, db.ForeignKey("map.id", use_alter=True), nullable=False, index=True
    )
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True, index=True)
    role = db.Column(db.String(20), nullable=True)  # 'viewer', 'editor', 'admin'

    # Отношения (lazy='select' для many-to-one)
    map = db.relationship("Map", backref="permissions", lazy="select")
    user = db.relationship("User", backref="map_permissions", lazy="select")

    # Один из user_id или role должен быть заполнен
    __table_args__ = (
        db.CheckConstraint(
            "(user_id IS NOT NULL) OR (role IS NOT NULL)", name="check_user_or_role"
        ),
        db.UniqueConstraint("map_id", "user_id", name="uq_map_user"),
        db.UniqueConstraint("map_id", "role", name="uq_map_role"),
    )


class DeviceHistory(db.Model):
    __tablename__ = "device_history"
    __table_args__ = (
        db.Index("idx_device_history_device_id_timestamp", "device_id", "timestamp"),
    )
    id = db.Column(db.Integer, primary_key=True)
    device_id = db.Column(db.Integer, db.ForeignKey("device.id"), index=True)
    old_status = db.Column(db.String(10))
    new_status = db.Column(db.String(10))
    timestamp = db.Column(db.DateTime, default=datetime.now, index=True)

    device = db.relationship("Device", backref="history")


class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), nullable=False)
    color = db.Column(db.String(7), default="#3498db")  # hex-код цвета
    font_size = db.Column(db.Integer, default=11)
    map_id = db.Column(db.Integer, db.ForeignKey("map.id"), index=True)
    map = db.relationship("Map", backref="groups")
    devices = db.relationship("Device", backref="group", lazy="dynamic")
    
    # Вложенные группы
    parent_group_id = db.Column(db.Integer, db.ForeignKey("group.id"), nullable=True, index=True)
    children = db.relationship("Group", backref=db.backref("parent", remote_side=[id]), lazy="dynamic")


class UserMapSettings(db.Model):
    """Настройки просмотра карты для конкретного пользователя."""

    __tablename__ = "user_map_settings"
    user_id = db.Column(
        db.Integer, db.ForeignKey("user.id"), primary_key=True, index=True
    )
    map_id = db.Column(
        db.Integer, db.ForeignKey("map.id"), primary_key=True, index=True
    )
    pan_x = db.Column(db.Float, default=0)
    pan_y = db.Column(db.Float, default=0)
    zoom = db.Column(db.Float, default=1)

    user = db.relationship("User", backref="map_settings")
    map = db.relationship("Map", backref="user_settings")


class MapShape(db.Model):
    __tablename__ = "map_shape"
    id = db.Column(db.Integer, primary_key=True)
    map_id = db.Column(db.Integer, db.ForeignKey("map.id"), nullable=False, index=True)
    shape_type = db.Column(
        db.String(20), nullable=False
    )  # square, rectangle, triangle, circle, diamond
    x = db.Column(db.Float, nullable=False)
    y = db.Column(db.Float, nullable=False)
    width = db.Column(db.Float, nullable=False)
    height = db.Column(db.Float, nullable=False)
    font_size = db.Column(db.Integer, default=12)
    color = db.Column(db.String(7), nullable=False, default="#3498db")
    opacity = db.Column(db.Float, nullable=False, default=1.0)
    description = db.Column(db.String(255), nullable=True)

    map = db.relationship("Map", backref="shapes")


class AuditLog(db.Model):
    """
    Журнал аудита всех значимых действий в системе.

    Логирует:
    - Действия с картами (создание, редактирование, удаление, блокировка)
    - Действия с устройствами (CRUD)
    - Изменения прав доступа
    - Действия с пользователями (вход, выход, смена пароля)
    - Изменения настроек
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        db.Index("idx_audit_user_timestamp", "user_id", "timestamp"),
        db.Index("idx_audit_target", "target_type", "target_id"),
        db.Index("idx_audit_action", "action"),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), index=True)
    username = db.Column(db.String(64))  # Денормализация для быстрого поиска
    action = db.Column(
        db.String(50), nullable=False, index=True
    )  # create_device, delete_map
    target_type = db.Column(db.String(30), index=True)  # device, map, user, permission
    target_id = db.Column(db.Integer, index=True)
    target_name = db.Column(db.String(128))  # Название объекта (имя карты, устройства)
    old_values = db.Column(db.JSON)  # Предыдущие значения (для обновлений)
    new_values = db.Column(db.JSON)  # Новые значения
    ip_address = db.Column(db.String(45))  # IP адрес клиента
    user_agent = db.Column(db.String(256))  # User-Agent браузера
    timestamp = db.Column(db.DateTime, default=datetime.now, index=True)

    # Отношения
    user = db.relationship("User", backref="audit_logs")
