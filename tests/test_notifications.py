"""
Регресс-тесты на payload'ы реалтайм-событий.

Ловят конкретные баги, которые уже случались:
- точечные события уходили БЕЗ map_id → клиент их отфильтровывал (реалтайм не работал);
- синхронизация блокировки должна нести is_locked/user_id/username.
"""

import pytest
from services import notifications


class TestGranularPayloads:
    """Каждое точечное событие обязано нести map_id и уходить в комнату map_<id>."""

    def test_device_created_carries_map_id(self, app, emit_recorder):
        with app.app_context():
            notifications.notify_device_created(7, {"id": 1, "name": "R1"})
        assert len(emit_recorder) == 1
        c = emit_recorder[0]
        assert c["event"] == "device_created"
        assert c["room"] == "map_7"
        assert c["payload"]["map_id"] == 7
        assert c["payload"]["device"] == {"id": 1, "name": "R1"}

    def test_position_event_carries_map_id_and_coords(self, app, emit_recorder):
        with app.app_context():
            notifications.notify_device_position_updated(7, 3, 120, 240)
        c = emit_recorder[0]
        assert c["event"] == "device_position_updated"
        assert c["payload"]["map_id"] == 7
        assert c["payload"]["device_id"] == 3
        assert c["payload"]["x"] == 120
        assert c["payload"]["y"] == 240

    @pytest.mark.parametrize(
        "call, event",
        [
            (lambda: notifications.notify_device_updated(7, {"id": 1}), "device_updated"),
            (lambda: notifications.notify_device_deleted(7, 1), "device_deleted"),
            (lambda: notifications.notify_bulk_position_updated(7, [1, 2]), "bulk_position_updated"),
            (lambda: notifications.notify_link_created(7, {"id": 1}), "link_created"),
            (lambda: notifications.notify_link_updated(7, {"id": 1}), "link_updated"),
            (lambda: notifications.notify_link_deleted(7, 1), "link_deleted"),
            (lambda: notifications.notify_group_created(7, {"id": 1}), "group_created"),
            (lambda: notifications.notify_group_updated(7, {"id": 1}), "group_updated"),
            (lambda: notifications.notify_group_deleted(7, 1), "group_deleted"),
            (lambda: notifications.notify_shape_created(7, {"id": 1}), "shape_created"),
            (lambda: notifications.notify_shape_updated(7, {"id": 1}), "shape_updated"),
            (lambda: notifications.notify_shape_deleted(7, 1), "shape_deleted"),
        ],
    )
    def test_all_granular_events_carry_map_id(self, app, emit_recorder, call, event):
        with app.app_context():
            call()
        assert emit_recorder, f"{event}: socketio.emit не вызван"
        c = emit_recorder[0]
        assert c["event"] == event
        assert c["room"] == "map_7"
        assert c["payload"]["map_id"] == 7


class TestLockSyncPayload:
    """Синхронизация блокировки карты между клиентами."""

    def test_map_lock_payload_shape(self, app, emit_recorder):
        with app.app_context():
            notifications.notify_map_lock(7, True, user_id=42, username="Иван")
        assert len(emit_recorder) == 1
        c = emit_recorder[0]
        assert c["event"] == "map_lock_updated"
        assert c["room"] == "map_7"
        assert c["payload"] == {
            "map_id": 7,
            "is_locked": True,
            "user_id": 42,
            "username": "Иван",
        }

    def test_map_lock_unlock_flag(self, app, emit_recorder):
        with app.app_context():
            notifications.notify_map_lock(7, False, user_id=1, username="Я")
        assert emit_recorder[0]["payload"]["is_locked"] is False
