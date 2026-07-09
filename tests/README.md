# LinkVision Testing Guide

## Overview

LinkVision uses `pytest` for testing with the following structure:

```
tests/
├── __init__.py
├── conftest.py                    # Shared fixtures and configuration
├── test_services.py               # Unit tests for services and validators
├── test_notifications.py          # Регресс: payload'ы реалтайм-событий (map_id, комната)
├── test_lock_and_permissions.py   # Регресс: блокировка карты + права доступа на edit
├── test_realtime_events.py        # Регресс: события add/update/move несут поля для рендера без F5
└── README.md
```

## Регресс-тесты ver2

Эти модули фиксируют поведение, которое уже ломалось, чтобы функционал не
деградировал при будущих правках:

- **`test_notifications.py`** — каждое точечное событие
  (`device/link/group/shape × create/update/delete/position` + `bulk_position`)
  обязано нести верхнеуровневый `map_id` и уходить в комнату `map_<id>`.
  Раньше `map_id` отсутствовал → клиент отфильтровывал событие и реалтайм не
  работал. Плюс проверка payload'а синхронизации блокировки (`map_lock_updated`).
- **`test_lock_and_permissions.py`** — заблокированная карта (`is_locked`)
  отдаёт `403` на edit-эндпоинтах (кроме админа); соблюдаются права
  владельца/viewer/editor/оператора/анонима; переключение замка через API.
- **`test_realtime_events.py`** — при добавлении/изменении/перемещении
  устройства сервер шлёт в событии поля, которых клиенту хватает для
  инкрементального обновления без перезагрузки: `pos_x/pos_y` (иначе устройство
  «уезжает» и «не появляется» без F5), `ips`, `iconUrl`, размеры.

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
| `login` | `login("testuser")` — залогинить пользователя через сессию без формы |
| `map_ids` | Словарь `{название карты: id}` тестовых карт |
| `router_type_id` | ID тестового типа устройства (Router) |
| `emit_recorder` | Перехватывает `socketio.emit` → список событий для проверки реалтайма |

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
