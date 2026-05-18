from extensions import socketio


def notify_map_updated(map_id, skip_sid=None):
    """Отправить всем в комнату карты (кроме skip_sid) сигнал об обновлении."""
    socketio.emit(
        "map_updated", {"map_id": map_id}, room=f"map_{map_id}", skip_sid=skip_sid
    )
