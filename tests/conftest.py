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
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False
    SECRET_KEY = 'test-secret-key'
    LOG_LEVEL = 'WARNING'
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

    app = Flask(__name__)
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
        admin = User(username='admin', is_admin=True)
        admin.set_password('Admin123!')
        db.session.add(admin)
        
        # Create test regular user
        user = User(username='testuser', is_admin=False)
        user.set_password('User123!')
        db.session.add(user)
        
        # Create test operator
        operator = User(username='operator', is_admin=False, is_operator=True)
        operator.set_password('Operator123!')
        db.session.add(operator)
        
        # Create device type
        dtype = DeviceType(name='Router', icon_filename='')
        db.session.add(dtype)
        
        db.session.commit()
        
        yield app
        
        # Cleanup
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    """Create test client."""
    return app.test_client()

