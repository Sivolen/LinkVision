"""
Integration tests for LinkVision.
"""

import pytest
import json
from models import User, Map, Device, DeviceType, DeviceIP, Link, MapPermission
from extensions import db


@pytest.mark.integration
class TestMapWorkflow:
    """Integration tests for complete map workflow."""

    def test_full_device_workflow(self, client, sample_map):
        """Test full device lifecycle: create -> update -> delete."""
        # Login
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        dtype = DeviceType.query.first()
        
        # Create device
        create_response = client.post('/api/device', json={
            'map_id': sample_map.id,
            'type_id': dtype.id,
            'name': 'Integration Test Device',
            'ips': ['192.168.1.100', '10.0.0.100'],
            'x': 200,
            'y': 200
        })
        
        assert create_response.status_code == 201
        device_data = json.loads(create_response.data)
        device_id = device_data['id']
        
        # Verify device exists in map elements
        elements_response = client.get(f'/api/map/{sample_map.id}/elements')
        assert elements_response.status_code == 200
        elements = json.loads(elements_response.data)
        device_ids = [n['data']['id'] for n in elements['nodes']]
        assert str(device_id) in device_ids
        
        # Update device
        update_response = client.put(f'/api/device/{device_id}', json={
            'name': 'Updated Device Name',
            'ips': ['192.168.1.101']
        })
        assert update_response.status_code == 200
        
        # Get device details
        details_response = client.get(f'/api/device/{device_id}')
        assert details_response.status_code == 200
        details = json.loads(details_response.data)
        assert details['name'] == 'Updated Device Name'
        
        # Delete device
        delete_response = client.delete(f'/api/device/{device_id}')
        assert delete_response.status_code == 200
        
        # Verify device deleted
        elements_response = client.get(f'/api/map/{sample_map.id}/elements')
        elements = json.loads(elements_response.data)
        device_ids = [n['data']['id'] for n in elements['nodes']]
        assert str(device_id) not in device_ids

    def test_link_workflow(self, client, sample_map):
        """Test creating and managing links."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        dtype = DeviceType.query.first()
        
        # Create two devices
        device1_response = client.post('/api/device', json={
            'map_id': sample_map.id,
            'type_id': dtype.id,
            'name': 'Device 1',
            'x': 100,
            'y': 100
        })
        device1_id = json.loads(device1_response.data)['id']
        
        device2_response = client.post('/api/device', json={
            'map_id': sample_map.id,
            'type_id': dtype.id,
            'name': 'Device 2',
            'x': 300,
            'y': 300
        })
        device2_id = json.loads(device2_response.data)['id']
        
        # Create link
        link_response = client.post('/api/link', json={
            'map_id': sample_map.id,
            'source_id': device1_id,
            'target_id': device2_id,
            'src_iface': 'eth0',
            'tgt_iface': 'eth1',
            'link_type': '1G',
            'line_color': '#3498db',
            'line_width': 3
        })
        assert link_response.status_code == 201
        link_id = json.loads(link_response.data)['id']
        
        # Update link
        update_response = client.put(f'/api/link/{link_id}', json={
            'link_type': '10G',
            'line_width': 5
        })
        assert update_response.status_code == 200
        
        # Delete link
        delete_response = client.delete(f'/api/link/{link_id}')
        assert delete_response.status_code == 200
        
        # Cleanup devices
        client.delete(f'/api/device/{device1_id}')
        client.delete(f'/api/device/{device2_id}')

    def test_map_lock_workflow(self, client, sample_map):
        """Test map lock/unlock workflow."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        # Lock map
        lock_response = client.put(f'/api/map/{sample_map.id}/lock', json={
            'locked': True
        })
        assert lock_response.status_code == 200
        data = json.loads(lock_response.data)
        assert data['is_locked'] is True
        
        # Verify lock status
        status_response = client.get(f'/api/map/{sample_map.id}/lock')
        status_data = json.loads(status_response.data)
        assert status_data['is_locked'] is True
        
        # Unlock map
        unlock_response = client.put(f'/api/map/{sample_map.id}/lock', json={
            'locked': False
        })
        assert unlock_response.status_code == 200
        data = json.loads(unlock_response.data)
        assert data['is_locked'] is False


@pytest.mark.integration
class TestPermissionsWorkflow:
    """Integration tests for permissions workflow."""

    def test_grant_revoke_permissions(self, client, sample_map):
        """Test granting and revoking permissions."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        user = User.query.filter_by(username='testuser').first()
        
        # Grant viewer permission
        grant_response = client.post(f'/api/map/{sample_map.id}/permissions', json={
            'user_id': user.id,
            'role': 'viewer'
        })
        assert grant_response.status_code == 201
        perm_id = json.loads(grant_response.data)['id']
        
        # Verify permission exists
        list_response = client.get(f'/api/map/{sample_map.id}/permissions')
        permissions = json.loads(list_response.data)
        assert len(permissions) == 1
        assert permissions[0]['role'] == 'viewer'
        
        # Update to editor
        update_response = client.put(f'/api/map/{sample_map.id}/permissions/{perm_id}', json={
            'role': 'editor'
        })
        assert update_response.status_code == 200
        
        # Verify update
        list_response = client.get(f'/api/map/{sample_map.id}/permissions')
        permissions = json.loads(list_response.data)
        assert permissions[0]['role'] == 'editor'
        
        # Revoke permission
        revoke_response = client.delete(f'/api/map/{sample_map.id}/permissions/{perm_id}')
        assert revoke_response.status_code == 200
        
        # Verify permission removed
        list_response = client.get(f'/api/map/{sample_map.id}/permissions')
        permissions = json.loads(list_response.data)
        assert len(permissions) == 0

    def test_operator_role_permission(self, client, sample_map):
        """Test granting role-based permission for operators."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        # Grant editor role to all operators
        response = client.post(f'/api/map/{sample_map.id}/permissions/role', json={
            'role': 'editor'
        })
        assert response.status_code == 201
        
        # Verify role permission exists
        list_response = client.get(f'/api/map/{sample_map.id}/permissions')
        permissions = json.loads(list_response.data)
        assert len(permissions) == 1
        assert permissions[0]['role'] == 'editor'
        assert permissions[0]['type'] == 'role'


@pytest.mark.integration
class TestAuditWorkflow:
    """Integration tests for audit logging."""

    def test_audit_log_creation(self, client, sample_map):
        """Test that actions are logged in audit."""
        client.post('/auth/login', data={
            'username': 'admin',
            'password': 'Admin123!'
        }, follow_redirects=True)
        
        dtype = DeviceType.query.first()
        
        # Create device (should be logged)
        client.post('/api/device', json={
            'map_id': sample_map.id,
            'type_id': dtype.id,
            'name': 'Audit Test Device',
            'x': 100,
            'y': 100
        })
        
        # Check audit logs
        logs_response = client.get('/api/audit/logs?per_page=10')
        assert logs_response.status_code == 200
        logs_data = json.loads(logs_response.data)
        
        # Should have at least login and create_device actions
        assert len(logs_data['logs']) > 0
        
        # Check for create_device action
        actions = [log['action'] for log in logs_data['logs']]
        assert 'create_device' in actions or 'login' in actions
