import time
import threading
import platform
import subprocess
from extensions import db, socketio
from models import Device, Settings

# Глобальная переменная для хранения приложения
app_instance = None


def init_monitor(app):
    """Инициализация монитора с приложением"""
    global app_instance
    app_instance = app


def ping_host(ip):
    param = '-n' if platform.system().lower() == 'windows' else '-c'
    command = ['ping', param, '1', ip]
    try:
        output = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        return output.returncode == 0
    except Exception:
        return False


def get_setting(key, default):
    # Используем контекст приложения если оно доступно
    if app_instance:
        with app_instance.app_context():
            s = Settings.query.filter_by(key=key).first()
            return int(s.value) if s else default
    return default


def monitor_loop():
    while True:
        try:
            if app_instance:
                with app_instance.app_context():
                    count = get_setting('ping_count', 4)
                    interval = get_setting('ping_interval', 10)

                    devices = Device.query.all()

                    for device in devices:
                        if device.ip_address:
                            is_up = ping_host(device.ip_address)

                            if device.status != is_up:
                                device.status = is_up
                                device.last_check = db.func.now()
                                db.session.commit()

                                socketio.emit('device_status', {
                                    'id': device.id,
                                    'status': is_up,
                                    'map_id': device.map_id
                                }, room=f"map_{device.map_id}")
            else:
                time.sleep(5)
        except Exception as e:
            print(f"Monitor error: {e}")
            time.sleep(5)

        time.sleep(10)  # Базовая задержка


def start_monitor():
    thread = threading.Thread(target=monitor_loop, daemon=True)
    thread.start()