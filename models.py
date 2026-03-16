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
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_map_id = db.Column(db.Integer, db.ForeignKey('map.id'), nullable=True)

    # Явно указываем foreign_keys для связи maps
    maps = db.relationship('Map', backref='owner', lazy='dynamic',
                           foreign_keys='Map.owner_id')
    last_map = db.relationship('Map', foreign_keys=[last_map_id])

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class DeviceType(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64))
    icon_filename = db.Column(db.String(256))
    width = db.Column(db.Integer, nullable=True)   # ширина иконки в пикселях
    height = db.Column(db.Integer, nullable=True)  # высота иконки в пикселях
    devices = db.relationship('Device', backref='type', lazy='dynamic')


class Device(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    map_id = db.Column(db.Integer, db.ForeignKey('map.id'))
    type_id = db.Column(db.Integer, db.ForeignKey('device_type.id'))
    name = db.Column(db.String(64))
    ip_address = db.Column(db.String(45))
    pos_x = db.Column(db.Float, default=0)
    pos_y = db.Column(db.Float, default=0)
    status = db.Column(db.Boolean, default=True)
    last_check = db.Column(db.DateTime, default=datetime.utcnow)
    group_id = db.Column(db.Integer, db.ForeignKey('group.id'), nullable=True)
    monitoring_enabled = db.Column(db.Boolean, default=True)

    source_links = db.relationship('Link', foreign_keys='Link.source_device_id', backref='source', lazy='dynamic', cascade='all, delete-orphan')
    target_links = db.relationship('Link', foreign_keys='Link.target_device_id', backref='target', lazy='dynamic', cascade='all, delete-orphan')



class Link(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    map_id = db.Column(db.Integer, db.ForeignKey('map.id'))
    source_device_id = db.Column(db.Integer, db.ForeignKey('device.id'))
    target_device_id = db.Column(db.Integer, db.ForeignKey('device.id'))
    source_interface = db.Column(db.String(32), default="eth0")
    target_interface = db.Column(db.String(32), default="eth0")
    # Новые поля для кастомизации линии
    link_type = db.Column(db.String(20), nullable=True)  # например: '100m', '1G', 'vlan', 'radio'
    line_color = db.Column(db.String(7), default="#6c757d")  # hex-код цвета
    line_width = db.Column(db.Integer, default=2)            # толщина линии в пикселях
    line_style = db.Column(db.String(10), default="solid")   # solid, dashed, dotted


class Settings(db.Model):
    key = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.String(256))


class Map(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128))
    owner_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    background_image = db.Column(db.String(256), nullable=True)  # новое поле
    devices = db.relationship('Device', backref='map', cascade="all, delete-orphan", lazy='dynamic')
    links = db.relationship('Link', backref='map', cascade="all, delete-orphan", lazy='dynamic')
    pan_x = db.Column(db.Float, default=0)
    pan_y = db.Column(db.Float, default=0)
    zoom = db.Column(db.Float, default=1)


class DeviceHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    device_id = db.Column(db.Integer, db.ForeignKey('device.id'))
    old_status = db.Column(db.Boolean)
    new_status = db.Column(db.Boolean)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    device = db.relationship('Device', backref='history')


class Group(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), nullable=False)
    color = db.Column(db.String(7), default="#3498db")  # hex-код цвета
    map_id = db.Column(db.Integer, db.ForeignKey('map.id'))
    map = db.relationship('Map', backref='groups')
    devices = db.relationship('Device', backref='group', lazy='dynamic')