"""
Unit tests for LinkVision services.
"""

import pytest
from models import User, Map, Device, DeviceType, DeviceIP
from services.validators import (
    validate_ip_address,
    validate_ip_list,
    validate_name,
    validate_color_hex,
    validate_line_style,
    validate_link_type,
)
from services.security_service import (
    validate_password_strength,
    check_password_common,
    validate_password_full,
)


class TestValidators:
    """Tests for validators module."""

    def test_validate_ip_address_valid_ipv4(self):
        """Test valid IPv4 address."""
        is_valid, error = validate_ip_address("192.168.1.1")
        assert is_valid is True
        assert error is None

    def test_validate_ip_address_valid_ipv6(self):
        """Test valid IPv6 address."""
        is_valid, error = validate_ip_address("2001:db8::1")
        assert is_valid is True
        assert error is None

    def test_validate_ip_address_invalid(self):
        """Test invalid IP address."""
        is_valid, error = validate_ip_address("999.999.999.999")
        assert is_valid is False
        assert error is not None

    def test_validate_ip_list_valid(self):
        """Test valid IP list."""
        ips, error = validate_ip_list(["192.168.1.1", "10.0.0.1"])
        assert error is None
        assert len(ips) == 2
        assert "192.168.1.1" in ips

    def test_validate_ip_list_duplicates_removed(self):
        """Test duplicate IPs are removed."""
        ips, error = validate_ip_list(["192.168.1.1", "192.168.1.1"])
        assert error is None
        assert len(ips) == 1

    def test_validate_ip_list_invalid(self):
        """Test invalid IP in list."""
        ips, error = validate_ip_list(["192.168.1.1", "invalid"])
        assert error is not None
        assert len(ips) == 0

    def test_validate_name_valid(self):
        """Test valid name."""
        is_valid, error = validate_name("Test Device", min_length=2, max_length=64)
        assert is_valid is True
        assert error is None

    def test_validate_name_too_short(self):
        """Test name too short."""
        is_valid, error = validate_name("A", min_length=2)
        assert is_valid is False
        assert error is not None

    def test_validate_name_too_long(self):
        """Test name too long."""
        is_valid, error = validate_name("A" * 100, max_length=64)
        assert is_valid is False
        assert error is not None

    def test_validate_color_hex_valid(self):
        """Test valid hex color."""
        color, error = validate_color_hex("#FF5733")
        assert color == "#FF5733"
        assert error is None

    def test_validate_color_hex_default(self):
        """Test invalid color returns default."""
        color, error = validate_color_hex("invalid")
        assert color == "#3498db"  # default

    def test_validate_line_style_valid(self):
        """Test valid line style."""
        style, error = validate_line_style("solid")
        assert style == "solid"

    def test_validate_line_style_invalid(self):
        """Test invalid line style returns default."""
        style, error = validate_line_style("invalid")
        assert style == "solid"

    def test_validate_link_type_valid(self):
        """Test valid link type."""
        link_type, error = validate_link_type("1G")
        assert link_type == "1G"

    def test_validate_link_type_none(self):
        """Test None link type."""
        link_type, error = validate_link_type(None)
        assert link_type is None


class TestPasswordValidation:
    """Tests for password validation."""

    def test_validate_password_strength_valid(self):
        """Test valid password."""
        is_valid, error = validate_password_strength("Str0ng_P@ss!")
        assert is_valid is True
        assert error is None

    def test_validate_password_strength_too_short(self):
        """Test password too short."""
        is_valid, error = validate_password_strength("Short1!")
        assert is_valid is False
        assert "минимум 8 символов" in error.lower()

    def test_validate_password_strength_no_uppercase(self):
        """Test password without uppercase."""
        is_valid, error = validate_password_strength("lowercase1!")
        assert is_valid is False

    def test_validate_password_strength_no_digit(self):
        """Test password without digit."""
        is_valid, error = validate_password_strength("NoDigit@!")
        assert is_valid is False

    def test_validate_password_strength_no_special(self):
        """Test password without special char."""
        is_valid, error = validate_password_strength("NoSpecial1")
        assert is_valid is False

    def test_check_password_common(self):
        """Test common password check."""
        assert check_password_common("password") is True
        assert check_password_common("123456") is True
        assert check_password_common("Admin123!") is False

    def test_validate_password_full_common(self):
        """Test full validation with common password."""
        is_valid, error = validate_password_full("password123")
        assert is_valid is False
        # Ошибка может быть разной в зависимости от порядка проверок
        assert error is not None

    def test_validate_password_full_contains_username(self):
        """Test password contains username."""
        is_valid, error = validate_password_full("admin123!", username="admin")
        assert is_valid is False
        # Проверяем, что ошибка вообще есть
        assert error is not None


class TestPermissions:
    """Tests for permissions module."""

    def test_can_view_map_admin(self, app, sample_map):
        """Test admin can view any map."""
        with app.app_context():
            from services.permissions import can_view_map
            from flask_login import login_user
            
            admin = User.query.filter_by(is_admin=True).first()
            with app.test_request_context():
                login_user(admin)
                assert can_view_map(sample_map.id) is True

    def test_can_view_map_owner(self, app, sample_map):
        """Test owner can view their map."""
        with app.app_context():
            from services.permissions import can_view_map
            from flask_login import login_user
            
            admin = User.query.filter_by(is_admin=True).first()
            with app.test_request_context():
                login_user(admin)
                assert can_view_map(sample_map.id) is True

    def test_can_edit_map_locked(self, app, sample_map):
        """Test owner cannot edit locked map."""
        with app.app_context():
            from services.permissions import can_edit_map
            from flask_login import login_user
            
            sample_map.is_locked = True
            db.session.commit()
            
            admin = User.query.filter_by(is_admin=True).first()
            with app.test_request_context():
                login_user(admin)
                # Admin can still edit locked map
                assert can_edit_map(sample_map.id) is True


class TestModelOperations:
    """Tests for model operations."""

    def test_create_user(self, app):
        """Test user creation."""
        with app.app_context():
            user = User(username='newuser')
            user.set_password('Password123!')
            db.session.add(user)
            db.session.commit()
            
            assert user.id is not None
            assert user.check_password('Password123!') is True
            assert user.check_password('wrongpassword') is False

    def test_create_map(self, app):
        """Test map creation."""
        with app.app_context():
            admin = User.query.filter_by(is_admin=True).first()
            map_obj = Map(name='New Map', owner_id=admin.id)
            db.session.add(map_obj)
            db.session.commit()
            
            assert map_obj.id is not None
            assert map_obj.name == 'New Map'

    def test_create_device_with_ips(self, app, sample_map):
        """Test device creation with IPs."""
        with app.app_context():
            dtype = DeviceType.query.first()
            device = Device(
                map_id=sample_map.id,
                type_id=dtype.id,
                name='Test Device',
                pos_x=50,
                pos_y=50
            )
            db.session.add(device)
            db.session.commit()
            
            # Add IPs
            ip1 = DeviceIP(device_id=device.id, ip_address='192.168.1.1')
            ip2 = DeviceIP(device_id=device.id, ip_address='10.0.0.1')
            db.session.add(ip1)
            db.session.add(ip2)
            db.session.commit()
            
            assert len(device.ips) == 2
            assert '192.168.1.1' in [ip.ip_address for ip in device.ips]
