from extensions import socketio
from services.map_service import invalidate_map_elements_cache


def notify_map_updated(map_id, skip_sid=None):
    """Отправить всем в комнату карты (кроме skip_sid) сигнал об обновлении и инвалидировать кэш."""
    # Инвалидация кэша элементов карты
    invalidate_map_elements_cache(map_id)

    # WebSocket уведомление
    socketio.emit(
        "map_updated", {"map_id": map_id}, room=f"map_{map_id}", skip_sid=skip_sid
    )
