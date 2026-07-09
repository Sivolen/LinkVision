"""
Pytest fixtures and configuration for LinkVision tests.
"""

import os
import pytest
from datetime import timedelta
from flask import Flask
from extensions import db, init_extensions, login_manager
from models import User, Map, Device, DeviceType

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class TestConfig:
    """Test configuration - полностью независимая."""

    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    WTF_CSRF_ENABLED = False
    SECRET_KEY = "test-secret-key"
    LOG_LEVEL = "WARNING"
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,
    }
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_TIMEZONE = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_REFRESH_EACH_REQUEST = True
    PERMANENT_SESSION_LIFETIME = timedelta(days=30)
    REMEMBER_COOKIE_DURATION = timedelta(days=30)
    DEBUG = False
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads", "icons")
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    VERSION = "2.0.0"

    # Отключаем безопасные куки для тестов
    SESSION_COOKIE_SECURE = False
    REMEMBER_COOKIE_SECURE = False


@pytest.fixture
def app():
    """Create application for tests."""
    from blueprints.auth import auth_bp
    from blueprints.admin import admin_bp
    from blueprints.main import main_bp
    from blueprints.api import api_bp

    # Указываем пути к шаблонам и статике от корня проекта
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    app = Flask(
        __name__,
        template_folder=os.path.join(project_root, "templates"),
        static_folder=os.path.join(project_root, "static"),
    )
    app.config.from_object(TestConfig)

    # Initialize extensions
    init_extensions(app)

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    # Отключаем CSRF для API endpoints
    from flask_wtf.csrf import CSRFProtect

    csrf = CSRFProtect(app)
    csrf.exempt(api_bp)

    # Настройка login_manager
    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    with app.app_context():
        # Create all tables
        db.create_all()

        # Create test admin user
        admin = User(username="admin", is_admin=True)
        admin.set_password("Admin123!")
        db.session.add(admin)

        # Create test regular user
        user = User(username="testuser", is_admin=False)
        user.set_password("User123!")
        db.session.add(user)

        # Create test operator
        operator = User(username="operator", is_admin=False, is_operator=True)
        operator.set_password("Operator123!")
        db.session.add(operator)

        # Create device type
        dtype = DeviceType(name="Router", icon_filename="")
        db.session.add(dtype)

        # Создаём карты для тестов прав доступа
        admin = User.query.filter_by(username="admin").first()
        testuser = User.query.filter_by(username="testuser").first()

        # Own Map (владелец: testuser)
        own_map = Map(name="Own Map", owner_id=testuser.id)
        db.session.add(own_map)

        # Foreign Map (владелец: admin)
        foreign_map = Map(name="Foreign Map", owner_id=admin.id)
        db.session.add(foreign_map)

        # Locked Map (владелец: testuser, заблокирована)
        locked_map = Map(name="Locked Map", owner_id=testuser.id, is_locked=True)
        db.session.add(locked_map)

        db.session.commit()

        # Shared Viewer Map (admin даёт testuser роль viewer)
        from models import MapPermission
        shared_viewer = Map(name="Shared Viewer Map", owner_id=admin.id)
        db.session.add(shared_viewer)
        db.session.commit()
        db.session.refresh(shared_viewer)
        db.session.add(MapPermission(map_id=shared_viewer.id, user_id=testuser.id, role="viewer"))

        # Shared Editor Map (admin даёт testuser роль editor)
        shared_editor = Map(name="Shared Editor Map", owner_id=admin.id)
        db.session.add(shared_editor)
        db.session.commit()
        db.session.refresh(shared_editor)
        db.session.add(MapPermission(map_id=shared_editor.id, user_id=testuser.id, role="editor"))

        # Operator Shared Map (admin даёт роль editor всем операторам)
        operator_shared = Map(name="Operator Shared Map", owner_id=admin.id)
        db.session.add(operator_shared)
        db.session.commit()
        db.session.refresh(operator_shared)
        db.session.add(MapPermission(map_id=operator_shared.id, role="editor"))

        # Devices
        db.session.add(Device(map_id=own_map.id, type_id=dtype.id, name="Own Device"))
        db.session.add(Device(map_id=foreign_map.id, type_id=dtype.id, name="Foreign Device"))

        db.session.commit()

        yield app

        # Cleanup
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    """Create test client."""
    return app.test_client()


@pytest.fixture
def login(client, app):
    """Залогинить пользователя по имени через сессию (без формы логина)."""
    def _login(username):
        with app.app_context():
            u = User.query.filter_by(username=username).first()
            assert u is not None, f"Нет тестового пользователя {username}"
            uid = u.id
        with client.session_transaction() as sess:
            sess["_user_id"] = str(uid)
            sess["_fresh"] = True
        return uid
    return _login


@pytest.fixture
def map_ids(app):
    """Словарь {название карты: id} для тестовых карт из conftest."""
    with app.app_context():
        return {m.name: m.id for m in Map.query.all()}


@pytest.fixture
def router_type_id(app):
    """ID тестового типа устройства (Router)."""
    with app.app_context():
        return DeviceType.query.filter_by(name="Router").first().id


@pytest.fixture
def emit_recorder(app, monkeypatch):
    """Перехватывает socketio.emit → список [{event, payload, room, skip_sid}]
    для проверки реалтайм-событий без реального веб-сокета."""
    from services import notifications
    calls = []

    def _rec(event, payload=None, **kwargs):
        calls.append(
            {
                "event": event,
                "payload": payload,
                "room": kwargs.get("room"),
                "skip_sid": kwargs.get("skip_sid"),
            }
        )

    monkeypatch.setattr(notifications.socketio, "emit", _rec)
    return calls


