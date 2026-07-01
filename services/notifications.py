from extensions import socketio
from services.map_service import invalidate_map_elements_cache


def notify_map_updated(map_id, skip_sid=None):
    """Отправить всем в комнату карты (кроме skip_sid) сигнал об обновлении и инвалидировать кэш."""
    invalidate_map_elements_cache(map_id)

    socketio.emit(
        "map_updated", {"map_id": map_id}, room=f"map_{map_id}", skip_sid=skip_sid
    )


# ─── Точечные уведомления ──────────────────────────────────────────────────────

def _notify(map_id, event, payload, skip_sid=None):
    """Отправить точечное событие в комнату карты."""
    socketio.emit(
        event, payload, room=f"map_{map_id}", skip_sid=skip_sid
    )


def notify_device_created(map_id, device_data, skip_sid=None):
    """Уведомление о создании устройства."""
    _notify(map_id, "device_created", {"device": device_data}, skip_sid)


def notify_device_updated(map_id, device_data, skip_sid=None):
    """Уведомление об обновлении устройства."""
    _notify(map_id, "device_updated", {"device": device_data}, skip_sid)


def notify_device_deleted(map_id, device_id, skip_sid=None):
    """Уведомление об удалении устройства."""
    _notify(map_id, "device_deleted", {"device_id": device_id}, skip_sid)


def notify_device_position_updated(map_id, device_id, x, y, skip_sid=None):
    """Уведомление об изменении позиции устройства."""
    _notify(map_id, "device_position_updated", {
        "device_id": device_id, "x": x, "y": y
    }, skip_sid)


def notify_bulk_position_updated(map_id, device_ids, skip_sid=None):
    """Уведомление о массовом изменении позиций."""
    _notify(map_id, "bulk_position_updated", {
        "device_ids": device_ids
    }, skip_sid)


def notify_link_created(map_id, link_data, skip_sid=None):
    """Уведомление о создании связи."""
    _notify(map_id, "link_created", {"link": link_data}, skip_sid)


def notify_link_updated(map_id, link_data, skip_sid=None):
    """Уведомление об обновлении связи."""
    _notify(map_id, "link_updated", {"link": link_data}, skip_sid)


def notify_link_deleted(map_id, link_id, skip_sid=None):
    """Уведомление об удалении связи."""
    _notify(map_id, "link_deleted", {"link_id": link_id}, skip_sid)


def notify_group_created(map_id, group_data, skip_sid=None):
    """Уведомление о создании группы."""
    _notify(map_id, "group_created", {"group": group_data}, skip_sid)


def notify_group_updated(map_id, group_data, skip_sid=None):
    """Уведомление об обновлении группы."""
    _notify(map_id, "group_updated", {"group": group_data}, skip_sid)


def notify_group_deleted(map_id, group_id, skip_sid=None):
    """Уведомление об удалении группы."""
    _notify(map_id, "group_deleted", {"group_id": group_id}, skip_sid)


def notify_shape_created(map_id, shape_data, skip_sid=None):
    """Уведомление о создании фигуры."""
    _notify(map_id, "shape_created", {"shape": shape_data}, skip_sid)


def notify_shape_updated(map_id, shape_data, skip_sid=None):
    """Уведомление об обновлении фигуры."""
    _notify(map_id, "shape_updated", {"shape": shape_data}, skip_sid)


def notify_shape_deleted(map_id, shape_id, skip_sid=None):
    """Уведомление об удалении фигуры."""
    _notify(map_id, "shape_deleted", {"shape_id": shape_id}, skip_sid)

