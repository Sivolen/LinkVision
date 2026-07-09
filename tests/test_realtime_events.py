"""
Интеграционные регресс-тесты на реалтайм-события устройств.

Гарантируют, что при add/update/move устройства сервер шлёт событие с полями,
которых клиенту хватает для инкрементального обновления БЕЗ F5:
- позиция (pos_x/pos_y) — иначе устройство «уезжает» в (100,100) и «не появляется»;
- ips + iconUrl/размеры — иначе смена IP/типа не видна другим клиентам.
"""


class TestDeviceCreatedEvent:
    def test_created_event_has_map_id_and_position(
        self, client, login, map_ids, router_type_id, emit_recorder
    ):
        login("testuser")
        emit_recorder.clear()
        r = client.post(
            "/api/device",
            json={
                "map_id": map_ids["Own Map"],
                "type_id": router_type_id,
                "name": "RT-1",
                "x": 150,
                "y": 250,
            },
        )
        assert r.status_code == 201

        created = [c for c in emit_recorder if c["event"] == "device_created"]
        assert created, "device_created не отправлен"
        payload = created[0]["payload"]
        assert payload["map_id"] == map_ids["Own Map"]
        dev = payload["device"]
        # Позиция должна прийти как pos_x/pos_y (клиент их читает)
        assert dev["pos_x"] == 150
        assert dev["pos_y"] == 250
        # Поля для инкрементального рендера
        for key in ("id", "name", "ips", "iconUrl", "status", "monitoring_enabled"):
            assert key in dev, f"нет поля {key} в device_created"


class TestDeviceUpdatedEvent:
    def _create(self, client, map_id, type_id):
        r = client.post(
            "/api/device",
            json={"map_id": map_id, "type_id": type_id, "name": "Base", "x": 10, "y": 20},
        )
        assert r.status_code == 201
        return r.get_json()["id"]

    def test_updated_event_carries_icon_and_ips(
        self, client, login, map_ids, router_type_id, emit_recorder
    ):
        login("testuser")
        dev_id = self._create(client, map_ids["Own Map"], router_type_id)

        emit_recorder.clear()
        r = client.put(
            f"/api/device/{dev_id}",
            json={"name": "Renamed", "ips": ["8.8.8.8"], "type_id": router_type_id},
        )
        assert r.status_code == 200

        updated = [c for c in emit_recorder if c["event"] == "device_updated"]
        assert updated, "device_updated не отправлен"
        dev = updated[0]["payload"]["device"]
        assert updated[0]["payload"]["map_id"] == map_ids["Own Map"]
        # Регресс: смена IP/типа должна отражаться в реалтайме → эти поля в payload
        assert dev["ips"] == ["8.8.8.8"]
        for key in ("iconUrl", "width", "height"):
            assert key in dev, f"нет поля {key} в device_updated (смена типа не отразится)"


class TestDevicePositionEvent:
    def test_position_event_carries_coords(
        self, client, login, map_ids, router_type_id, emit_recorder
    ):
        login("testuser")
        r = client.post(
            "/api/device",
            json={"map_id": map_ids["Own Map"], "type_id": router_type_id, "name": "Pos", "x": 1, "y": 2},
        )
        assert r.status_code == 201
        dev_id = r.get_json()["id"]

        emit_recorder.clear()
        pr = client.put(f"/api/device/{dev_id}/position", json={"x": 333, "y": 444})
        assert pr.status_code == 200

        pos = [c for c in emit_recorder if c["event"] == "device_position_updated"]
        assert pos, "device_position_updated не отправлен"
        payload = pos[0]["payload"]
        assert payload["map_id"] == map_ids["Own Map"]
        assert payload["x"] == 333
        assert payload["y"] == 444
