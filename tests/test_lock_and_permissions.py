"""
Интеграционные регресс-тесты на права доступа и блокировку карты.

Гарантируют, что «заблокировать изменения карты» действительно работает на
сервере (edit-эндпоинты отдают 403 при is_locked), и что права владельца/чужой
карты соблюдаются.
"""


def _create_device_payload(map_id, type_id, name="Test Device"):
    return {"map_id": map_id, "type_id": type_id, "name": name}


class TestLockEnforcement:
    """Заблокированная карта не принимает изменения (кроме админа)."""

    def test_locked_map_blocks_device_create(
        self, client, login, map_ids, router_type_id
    ):
        login("testuser")  # владелец Locked Map
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Locked Map"], router_type_id),
        )
        assert r.status_code == 403

    def test_unlocked_own_map_allows_device_create(
        self, client, login, map_ids, router_type_id
    ):
        login("testuser")
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Own Map"], router_type_id),
        )
        assert r.status_code == 201

    def test_admin_can_create_on_locked_map(
        self, client, login, map_ids, router_type_id
    ):
        login("admin")  # админ обходит блокировку
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Locked Map"], router_type_id),
        )
        assert r.status_code == 201

    def test_map_admin_can_lock_and_unlock_map(self, client, login, map_ids):
        # Создаём персонального map-admin для обычного пользователя.
        from models import MapPermission, User, Map
        from extensions import db

        admin_map = Map.query.filter_by(name="Foreign Map").first()
        user = User.query.filter_by(username="testuser").first()
        db.session.add(MapPermission(map_id=admin_map.id, user_id=user.id, role="admin"))
        db.session.commit()

        login("testuser")
        mid = admin_map.id

        r = client.put(f"/api/map/{mid}/lock", json={"locked": True})
        assert r.status_code == 200
        assert r.get_json()["is_locked"] is True

        r = client.put(f"/api/map/{mid}/lock", json={"locked": False})
        assert r.status_code == 200
        assert r.get_json()["is_locked"] is False


class TestAccessControl:
    """Кто может редактировать какую карту."""

    def test_foreign_map_create_forbidden(self, client, login, map_ids, router_type_id):
        login("testuser")  # не владелец Foreign Map, прав нет
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Foreign Map"], router_type_id),
        )
        assert r.status_code == 403

    def test_editor_permission_allows_create(
        self, client, login, map_ids, router_type_id
    ):
        login("testuser")  # роль editor на Shared Editor Map
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Shared Editor Map"], router_type_id),
        )
        assert r.status_code == 201

    def test_operator_without_map_permission_cannot_create_device(
        self, client, login, map_ids, router_type_id
    ):
        login("operator")
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Shared Editor Map"], router_type_id),
        )
        assert r.status_code == 403


    def test_viewer_permission_forbids_create(
        self, client, login, map_ids, router_type_id
    ):
        login("testuser")  # роль viewer на Shared Viewer Map
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Shared Viewer Map"], router_type_id),
        )
        assert r.status_code == 403

    def test_operator_with_editor_role_can_create_device(
        self, client, login, map_ids, router_type_id
    ):
        login("operator")
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Operator Shared Map"], router_type_id),
        )
        assert r.status_code == 201

    def test_anonymous_forbidden(self, client, map_ids, router_type_id):
        r = client.post(
            "/api/device",
            json=_create_device_payload(map_ids["Own Map"], router_type_id),
        )
        assert r.status_code in (401, 403, 302)  # не авторизован


class TestLockToggle:
    """Переключение блокировки через API."""

    def test_owner_can_lock_own_map(self, client, login, map_ids):
        login("testuser")
        mid = map_ids["Own Map"]
        r = client.put(f"/api/map/{mid}/lock", json={"locked": True})
        assert r.status_code == 200
        assert r.get_json()["is_locked"] is True
        # GET отражает новое состояние
        g = client.get(f"/api/map/{mid}/lock")
        assert g.status_code == 200
        assert g.get_json()["is_locked"] is True

    def test_admin_can_unlock_locked_map(self, client, login, map_ids):
        login("admin")
        mid = map_ids["Locked Map"]
        r = client.put(f"/api/map/{mid}/lock", json={"locked": False})
        assert r.status_code == 200
        assert r.get_json()["is_locked"] is False
