import time
import platform
import subprocess
from extensions import db, socketio  # ✅ Импортируем socketio
from models import Device, Settings

app_instance = None


def init_monitor(app):
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
    if app_instance:
        with app_instance.app_context():
            s = Settings.query.filter_by(key=key).first()
            return int(s.value) if s else default
    return default


def monitor_loop():
    while True:
        try:
            with app_instance.app_context():
                devices = Device.query.all()
                for device in devices:
                    if device.ip_address:
                        is_up = ping_host(device.ip_address)

                        # Отправляем событие ТОЛЬКО если статус изменился
                        if device.status != is_up:
                            device.status = is_up
                            device.last_check = db.func.now()
                            db.session.commit()

                            # ✅ ИСПРАВЛЕНО: Отправка в конкретную комнату
                            room_name = f'map_{device.map_id}'
                            socketio.emit('device_status', {
                                'id': device.id,
                                'status': is_up,
                                'map_id': device.map_id
                            }, room=room_name)  # ✅ room= обязательно!

                            print(f"📤 Отправлено device_status: id={device.id}, status={is_up}, room={room_name}")

                        time.sleep(0.1)

        except Exception as e:
            print(f"❌ Monitor error: {e}")

        interval = get_setting('ping_interval', 10)
        time.sleep(interval)


def start_monitor():
    # ✅ ИСПРАВЛЕНО: Используем socketio.start_background_task вместо threading.Thread
    socketio.start_background_task(monitor_loop)
    print("✅ Мониторинг запущен через socketio.start_background_task()")