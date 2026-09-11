from models import Settings, db
from utils.logger import admin_logger


def get_setting(key, default=None):
    """Получить значение настройки."""
    setting = Settings.query.filter_by(key=key).first()
    return setting.value if setting else default


def update_setting(key, value):
    """Обновить или создать настройку."""
    setting = Settings.query.filter_by(key=key).first()
    if setting:
        setting.value = value
    else:
        setting = Settings(key=key, value=value)
        db.session.add(setting)
    db.session.commit()
    admin_logger.info(f"Setting updated: {key}={value}")
    return setting


def get_ping_settings():
    """Получить настройки пинга (count и interval)."""
    count = get_setting("ping_count", "4")
    interval = get_setting("ping_interval", "10")
    return int(count), int(interval)


def get_monitor_settings():
    """Получить настройки мониторинга (count, interval, timeout, retention).

    Используется роутом /admin/settings для рендера формы. Значения
    возвращаются приведёнными к типам, в которых их ожидают шаблон и
    services/monitor.py (int/int/float/int).
    """
    count = get_setting("ping_count", "4")
    interval = get_setting("ping_interval", "10")
    timeout = get_setting("ping_timeout", "1.0")
    retention = get_setting("history_retention_days", "7")
    return int(count), int(interval), float(timeout), int(retention)


def update_ping_settings(
    ping_count, ping_interval, ping_timeout, history_retention_days
):
    """Обновить настройки мониторинга с валидацией диапазонов.

    ping_count: 1-10 пакетов на адрес; ping_interval: 5-300 секунд;
    ping_timeout: 0.2-10 секунд на один ICMP-пакет;
    history_retention_days: 1-3650 дней хранения истории UP/DOWN
    и агрегатов качества.
    """
    try:
        count = int(ping_count)
        interval = int(ping_interval)
        timeout = float(ping_timeout)
        retention = int(history_retention_days)
    except (TypeError, ValueError):
        raise ValueError("Настройки мониторинга должны быть числами")
    if not 1 <= count <= 10:
        raise ValueError("Количество пакетов должно быть от 1 до 10")
    if not 5 <= interval <= 300:
        raise ValueError("Интервал проверки должен быть от 5 до 300 секунд")
    if not 0.2 <= timeout <= 10:
        raise ValueError("Таймаут ICMP должен быть от 0.2 до 10 секунд")
    if not 1 <= retention <= 3650:
        raise ValueError("Срок хранения истории должен быть от 1 до 3650 дней")
    update_setting("ping_count", str(count))
    update_setting("ping_interval", str(interval))
    update_setting("ping_timeout", str(timeout))
    update_setting("history_retention_days", str(retention))
