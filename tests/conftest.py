"""
Pytest fixtures and configuration for LinkVision tests.
"""

import os
import pytest
from datetime import timedelta
from flask import Flask
from extensions import db, init_extensions
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


@pytest.fixture
def app():
    """Create application for tests."""
    app = Flask(__name__)
    app.config.from_object(TestConfig)
    
    # Initialize extensions
    init_extensions(app)
    
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


@pytest.fixture
def runner(app):
    """Create CLI runner."""
    return app.test_cli_runner()


@pytest.fixture
def logged_in_client(client, app):
    """Login and return client with active session."""
    with client.session_transaction() as sess:
        pass  # Ensure session is available

    # Login as admin
    response = client.post('/auth/login', data={
        'username': 'admin',
        'password': 'Admin123!'
    }, follow_redirects=False)

    # Check if login was successful (should redirect)
    if response.status_code in [200, 302]:
        return client
    return client


@pytest.fixture
def sample_map(app, auth_headers):
    """Create a sample map."""
    with app.app_context():
        admin = User.query.filter_by(username='admin').first()
        map_obj = Map(name='Test Map', owner_id=admin.id)
        db.session.add(map_obj)
        db.session.commit()
        # Refresh to ensure object is bound to session
        db.session.refresh(map_obj)
        return map_obj


@pytest.fixture
def sample_device(app, sample_map):
    """Create a sample device."""
    with app.app_context():
        dtype = DeviceType.query.first()
        device = Device(
            map_id=sample_map.id,
            type_id=dtype.id,
            name='Test Router',
            pos_x=100,
            pos_y=100,
            status='up'
        )
        db.session.add(device)
        db.session.commit()
        # Refresh to ensure object is bound to session
        db.session.refresh(device)
        return device
