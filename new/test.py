
"""
Регрессионные тесты контроля доступа для «создающих» эндпоинтов API.

Покрывают три уязвимости broken access control, найденные ревью и затем
исправленные:

1. POST /api/device  — можно было создать устройство на ЛЮБОЙ карте,
   не имея к ней прав (проверялось только существование карты).
2. POST /api/link    — то же самое для связей.
3. POST /api/map/import — можно было стереть и перезаписать содержимое
   ЛЮБОЙ чужой карты, просто передав её id в теле запроса.

Если кто-то в будущем случайно уберёт проверку can_edit_map() из одного
из этих роутов (например, при рефакторинге) — эти тесты сразу покраснеют.

Пользователи и карты берутся из общей фикстуры `app` (tests/conftest.py):

    testuser  — обычный пользователь, владелец own_map и locked_map
    admin     — администратор, владелец foreign_map/shared_viewer/
                shared_editor/operator_shared
    operator  — пользователь с ролью is_operator=True

    own_map          — принадлежит testuser
    foreign_map      — принадлежит admin, у testuser нет прав вообще
    locked_map       — принадлежит testuser, но is_locked=True
    shared_viewer    — принадлежит admin, testuser имеет роль viewer
    shared_editor    — принадлежит admin, testuser имеет роль editor
    operator_shared  — принадлежит admin, роль editor выдана всем операторам
"""

import pytest
from models import Map, DeviceType
from services.security_service import rate_limiter


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """
    rate_limiter — модульный синглтон (services/security_service.py),
    общий на весь тестовый процесс. Каждый тест в этом файле логинится
    заново, поэтому без сброса между тестами легко упереться в лимит
    5 попыток / 5 минут на /auth/login и словить случайные фейлы.
    """
    rate_limiter.reset_all()
    yield
    rate_limiter.reset_all()


def login(client, username, password):
    """Логин через форму (CSRF отключён в тестовом конфиге, см. conftest.py)."""
    return client.post(
        "/auth/login",
        data={"username": username, "password": password},
        follow_redirects=True,
    )


def get_map_id(app, name: str) -> int:
    with app.app_context():
        return Map.query.filter_by(name=name).first().id


def get_device_type_id(app) -> int:
    with app.app_context():
        return DeviceType.query.first().id


class TestCreateDeviceAccessControl:
    """POST /api/device"""

    def test_cannot_create_device_on_foreign_map(self, app, client):
        login(client, "testuser", "User123!")
        map_id = get_map_id(app, "Foreign Map")
        type_id = get_device_type_id(app)

        resp = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "Evil Device"},
        )

        assert resp.status_code == 403
        assert resp.get_json()["error"] == "Доступ запрещён"

        with app.app_context():
            assert Map.query.get(map_id).devices == []

    def test_can_create_device_on_own_map(self, app, client):
        login(client, "testuser", "User123!")
        map_id = get_map_id(app, "Own Map")
        type_id = get_device_type_id(app)

        resp = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "My Device"},
        )

        assert resp.status_code == 201
        assert "id" in resp.get_json()

    def test_can_create_device_with_editor_permission(self, app, client):
        login(client, "testuser", "User123!")
        map_id = get_map_id(app, "Shared Editor Map")
        type_id = get_device_type_id(app)

        resp = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "Shared Device"},
        )

        assert resp.status_code == 201

    def test_cannot_create_device_with_viewer_permission(self, app, client):
        login(client, "testuser", "User123!")
        map_id = get_map_id(app, "Shared Viewer Map")
        type_id = get_device_type_id(app)
09:04
resp = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "Should Fail"},
        )

        assert resp.status_code == 403

    def test_owner_cannot_edit_own_locked_map(self, app, client):
        """Владелец не может редактировать собственную карту, пока она заблокирована."""
        login(client, "testuser", "User123!")
        map_id = get_map_id(app, "Locked Map")
        type_id = get_device_type_id(app)

        resp = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "Should Fail"},
        )

        assert resp.status_code == 403

    def test_admin_can_create_device_on_any_map(self, app, client):
        login(client, "admin", "Admin123!")
        map_id = get_map_id(app, "Own Map")  # чужая для admin, но админу можно всё
        type_id = get_device_type_id(app)

        resp = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "Admin Device"},
        )

        assert resp.status_code == 201

    def test_operator_is_blocked_regardless_of_permission(self, app, client):
        """
        ВАЖНО (это не баг теста, а задокументированное поведение):
        @require_not_operator блокирует любого оператора на уровне роута —
        ДО того, как код успевает дойти до can_edit_map(). Из-за этого явная
        выдача роли editor оператору через MapPermission (см. operator_shared)
        сейчас не даёт оператору создавать устройства: он в любом случае
        получит 403 с сообщением "Оператор не может выполнять это действие".

        Логика can_edit_map() отдельно умеет обрабатывать "оператор с
        разрешением editor" — но create_device/create_link до неё в этом
        случае не доходят. Если операторам ДОЛЖНА быть доступна эта функция
        при наличии явного editor-разрешения — стоит завести отдельный тикет,
        этот тест как раз документирует текущее (возможно, неполное) поведение.
        """
        login(client, "operator", "Operator123!")
        map_id = get_map_id(app, "Operator Shared Map")
        type_id = get_device_type_id(app)

        resp = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "Operator Device"},
        )

        assert resp.status_code == 403
        assert "Оператор" in resp.get_json()["error"]

    def test_unauthenticated_cannot_create_device(self, app, client):
        map_id = get_map_id(app, "Own Map")
        type_id = get_device_type_id(app)

        resp = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "Anon Device"},
        )

        # Flask-Login по умолчанию редиректит на login_view для неаутентифицированных
        assert resp.status_code in (302, 401)


class TestCreateLinkAccessControl:
    """POST /api/link"""

    @staticmethod
    def _create_two_devices(client, map_id, type_id):
        r1 = client.post(
            "/api/device", json={"map_id": map_id, "type_id": type_id, "name": "D1"}
        )
        r2 = client.post(
            "/api/device", json={"map_id": map_id, "type_id": type_id, "name": "D2"}
        )
        assert r1.status_code == 201 and r2.status_code == 201
        return r1.get_json()["id"], r2.get_json()["id"]

    def test_cannot_create_link_on_foreign_map(self, app, client):
        # Устройства создаёт владелец карты (admin), а связь на них
        # пытается повесить testuser, у которого нет прав на эту карту.
        login(client, "admin", "Admin123!")
        map_id = get_map_id(app, "Foreign Map")
        type_id = get_device_type_id(app)
        source_id, target_id = self._create_two_devices(client, map_id, type_id)
        client.get("/auth/logout")

        login(client, "testuser", "User123!")
        resp = client.post(
            "/api/link",
            json={"map_id": map_id, "source_id": source_id, "target_id": target_id},
        )
09:04
assert resp.status_code == 403
        assert resp.get_json()["error"] == "Доступ запрещён"

    def test_can_create_link_on_own_map(self, app, client):
        login(client, "testuser", "User123!")
        map_id = get_map_id(app, "Own Map")
        type_id = get_device_type_id(app)
        source_id, target_id = self._create_two_devices(client, map_id, type_id)

        resp = client.post(
            "/api/link",
            json={"map_id": map_id, "source_id": source_id, "target_id": target_id},
        )

        assert resp.status_code == 201


class TestImportMapAccessControl:
    """POST /api/map/import — регрессия на самую критичную находку ревью:
    возможность стереть и перезаписать содержимое чужой карты."""

    def test_cannot_overwrite_foreign_map(self, app, client):
        login(client, "testuser", "User123!")
        map_id = get_map_id(app, "Foreign Map")

        resp = client.post(
            "/api/map/import",
            json={"id": map_id, "name": "Pwned", "devices": [], "links": [], "groups": []},
        )

        assert resp.status_code == 403
        assert resp.get_json()["error"] == "Доступ запрещён"

        # Карта не должна была измениться
        with app.app_context():
            db_map = Map.query.get(map_id)
            assert db_map.name == "Foreign Map"

    def test_can_overwrite_own_map(self, app, client):
        login(client, "testuser", "User123!")
        map_id = get_map_id(app, "Own Map")

        resp = client.post(
            "/api/map/import",
            json={"id": map_id, "name": "Renamed by owner", "devices": [], "links": [], "groups": []},
        )

        assert resp.status_code == 200

        with app.app_context():
            assert Map.query.get(map_id).name == "Renamed by owner"

    def test_import_without_id_creates_new_map_owned_by_current_user(self, app, client):
        login(client, "testuser", "User123!")

        resp = client.post(
            "/api/map/import",
            json={"name": "Brand New Map", "devices": [], "links": [], "groups": []},
        )

        assert resp.status_code == 200
        new_id = resp.get_json()["id"]

        with app.app_context():
            from models import User
            testuser = User.query.filter_by(username="testuser").first()
            new_map = Map.query.get(new_id)
            assert new_map.owner_id == testuser.id