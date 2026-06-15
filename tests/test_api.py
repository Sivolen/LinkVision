"""
API endpoint tests for LinkVision.
"""

import pytest
import json
from models import User, Map, Device, DeviceType
from extensions import db


class TestAuthAPI:
    """Tests for authentication endpoints."""

    def test_login_success(self, client):
        """Test successful login."""
        response = client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        assert response.status_code == 200

    def test_login_wrong_password(self, client):
        """Test login with wrong password."""
        response = client.post('/auth/login', data={
            'username': 'admin',
            'password': 'wrongpassword'
        }, follow_redirects=True)
        
        assert response.status_code == 200

    def test_logout(self, client):
        """Test logout."""
        # First login
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        # Then logout
        response = client.get('/auth/logout', follow_redirects=True)
        assert response.status_code == 200


class TestMapAPI:
    """Tests for map endpoints."""

    def test_get_maps_authenticated(self, client, sample_map):
        """Test getting maps when authenticated."""
        # Login
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.get('/api/maps')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert isinstance(data, list)

    def test_get_map_elements(self, client, sample_map):
        """Test getting map elements."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.get(f'/api/map/{sample_map.id}/elements')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'nodes' in data
        assert 'edges' in data

    def test_get_map_elements_not_found(self, client):
        """Test getting non-existent map."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.get('/api/map/9999/elements')
        assert response.status_code == 404


class TestDeviceAPI:
    """Tests for device endpoints."""

    def test_create_device(self, client, sample_map):
        """Test creating a device."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        dtype = DeviceType.query.first()
        
        response = client.post('/api/device', json={
            'map_id': sample_map.id,
            'type_id': dtype.id,
            'name': 'New Device',
            'ips': ['192.168.1.1'],
            'x': 100,
            'y': 100
        })
        
        assert response.status_code == 201
        data = json.loads(response.data)
        assert 'id' in data

    def test_create_device_invalid_ip(self, client, sample_map):
        """Test creating device with invalid IP."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        dtype = DeviceType.query.first()
        
        response = client.post('/api/device', json={
            'map_id': sample_map.id,
            'type_id': dtype.id,
            'name': 'New Device',
            'ips': ['invalid-ip']
        })
        
        assert response.status_code == 400

    def test_get_device(self, client, sample_device):
        """Test getting device details."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.get(f'/api/device/{sample_device.id}')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['id'] == sample_device.id
        assert data['name'] == sample_device.name

    def test_update_device(self, client, sample_device):
        """Test updating device."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.put(f'/api/device/{sample_device.id}', json={
            'name': 'Updated Device Name'
        })
        
        assert response.status_code == 200

    def test_delete_device(self, client, sample_device):
        """Test deleting device."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.delete(f'/api/device/{sample_device.id}')
        assert response.status_code == 200


class TestHealthCheck:
    """Tests for health check endpoint."""

    def test_health_check(self, client):
        """Test health check endpoint."""
        response = client.get('/health')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'status' in data
        assert data['status'] == 'healthy'
        assert 'database' in data
        assert data['database'] == 'ok'

    def test_health_check_stats(self, client, sample_map, sample_device):
        """Test health check includes stats."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.get('/health')
        data = json.loads(response.data)
        assert 'stats' in data
        assert 'users' in data['stats']
        assert 'maps' in data['stats']
        assert 'devices' in data['stats']


class TestPermissionsAPI:
    """Tests for permissions endpoints."""

    def test_get_map_permissions(self, client, sample_map):
        """Test getting map permissions."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.get(f'/api/map/{sample_map.id}/permissions')
        assert response.status_code == 200

    def test_add_map_permission(self, client, sample_map):
        """Test adding map permission."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        user = User.query.filter_by(username='testuser').first()
        
        response = client.post(f'/api/map/{sample_map.id}/permissions', json={
            'user_id': user.id,
            'role': 'viewer'
        })
        
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data['role'] == 'viewer'

    def test_delete_map_permission(self, client, sample_map):
        """Test deleting map permission."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        user = User.query.filter_by(username='testuser').first()
        
        # Add permission first
        add_response = client.post(f'/api/map/{sample_map.id}/permissions', json={
            'user_id': user.id,
            'role': 'viewer'
        })
        perm_id = json.loads(add_response.data)['id']
        
        # Delete permission
        response = client.delete(f'/api/map/{sample_map.id}/permissions/{perm_id}')
        assert response.status_code == 200


class TestAuditAPI:
    """Tests for audit endpoints."""

    def test_get_audit_logs_admin(self, client):
        """Test getting audit logs as admin."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        response = client.get('/api/audit/logs')
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'logs' in data
        assert 'page' in data

    def test_get_audit_logs_non_admin(self, client):
        """Test getting audit logs as non-admin."""
        # Login as regular user
        client.post('/auth/login', data={
            'username': 'testuser',
            'password': 'User123!'
        }, follow_redirects=True)
        
        response = client.get('/api/audit/logs')
        assert response.status_code == 403
