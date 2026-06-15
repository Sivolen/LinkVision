# LinkVision Testing Guide

## Overview

LinkVision uses `pytest` for testing with the following structure:

```
tests/
├── __init__.py
├── conftest.py          # Shared fixtures and configuration
├── test_services.py     # Unit tests for services and validators
├── test_api.py          # API endpoint tests
├── test_integration.py  # Integration tests for workflows
└── README.md
```

## Setup

### Install test dependencies

```bash
pip install -r requirements-test.txt
```

## Running Tests

### All tests
```bash
pytest tests/ -v
```

### Specific test type
```bash
# Unit tests only
pytest tests/test_services.py -v

# API tests only
pytest tests/test_api.py -v

# Integration tests only
pytest tests/test_integration.py -v
```

### With coverage
```bash
pytest tests/ --cov=services --cov-report=term-missing
```

### Using the run script
```bash
chmod +x run_tests.sh

# All tests
./run_tests.sh all

# Unit tests with coverage
./run_tests.sh unit true
```

### Specific markers
```bash
# Skip slow tests
pytest tests/ -v -m "not slow"

# Run only integration tests
pytest tests/ -v -m "integration"
```

## Test Fixtures

### Available fixtures in conftest.py

| Fixture | Description |
|---------|-------------|
| `app` | Flask application with test config |
| `client` | Test client for making requests |
| `runner` | CLI test runner |
| `auth_headers` | Authenticated session headers |
| `sample_map` | Creates a test map |
| `sample_device` | Creates a test device on map |

### Using fixtures
```python
def test_example(client, sample_map):
    """Test using fixtures."""
    response = client.get(f'/api/map/{sample_map.id}')
    assert response.status_code == 200
```

## Test Configuration

### TestConfig
```python
class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False
    SECRET_KEY = 'test-secret-key'
    LOG_LEVEL = 'WARNING'
```

## Writing Tests

### Unit test example
```python
def test_validate_ip_address_valid():
    """Test valid IPv4 address."""
    is_valid, error = validate_ip_address("192.168.1.1")
    assert is_valid is True
    assert error is None
```

### API test example
```python
def test_create_device(client, sample_map):
    """Test creating a device."""
    client.post('/auth/login', data={
        'username': 'admin',
        'password': 'Admin123!'
    }, follow_redirects=True)
    
    response = client.post('/api/device', json={
        'map_id': sample_map.id,
        'type_id': 1,
        'name': 'Test Device'
    })
    
    assert response.status_code == 201
```

### Integration test example
```python
@pytest.mark.integration
def test_full_device_workflow(client, sample_map):
    """Test full device lifecycle."""
    # Create
    create_response = client.post('/api/device', json={...})
    assert create_response.status_code == 201
    device_id = json.loads(create_response.data)['id']
    
    # Update
    update_response = client.put(f'/api/device/{device_id}', json={...})
    assert update_response.status_code == 200
    
    # Delete
    delete_response = client.delete(f'/api/device/{device_id}')
    assert delete_response.status_code == 200
```

## Test Markers

- `unit` - Unit tests (fast, isolated)
- `integration` - Integration tests (test workflows)
- `slow` - Slow tests (deselect with `-m "not slow"`)

## Coverage Report

Generate HTML coverage report:
```bash
pytest tests/ --cov=services --cov-report=html
open htmlcov/index.html
```

## CI/CD Integration

Tests are run automatically on push to main branch. Minimum coverage requirement: 70%
