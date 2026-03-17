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
    count = get_setting('ping_count', '4')
    interval = get_setting('ping_interval', '10')
    return int(count), int(interval)

def update_ping_settings(ping_count, ping_interval):
    """Обновить настройки пинга."""
    update_setting('ping_count', str(ping_count))
    update_setting('ping_interval', str(ping_interval))