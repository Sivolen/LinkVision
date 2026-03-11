import time
import platform
import subprocess
import os
from extensions import db, socketio
from models import Device, Settings

app_instance = None
last_emit_time = {}  # Дебаунс событий
_monitor_started = False  # Флаг для предотвращения повторного запуска


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
    global last_emit_time
    # Защита от запуска в дочернем процессе релоадера
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        print("⚙️ Релоадер: монитор запущен в основном процессе")
    else:
        print("⚙️ Монитор запущен")

    while True:
        try:
            with app_instance.app_context():
                devices = Device.query.all()

                for device in devices:
                    if device.ip_address:
                        is_up = ping_host(device.ip_address)

                        import time as time_module
                        last_time = last_emit_time.get(device.id, 0)

                        # Дебаунс 0.5 секунды
                        if time_module.time() - last_time < 0.5:
                            continue

                        if device.status != is_up:
                            room_name = f'map_{device.map_id}'
                            status_str = 'true' if is_up else 'false'

                            # Отправка события
                            socketio.emit('device_status', {
                                'id': device.id,
                                'status': status_str,
                                'map_id': device.map_id
                            }, room=room_name)

                            status_display = "UP ✅" if is_up else "DOWN ❌"
                            print(f"📤 [{status_display}] Отправлено: id={device.id}, status={status_str}, room={room_name}")

                            # Обновление БД
                            device.status = is_up
                            device.last_check = db.func.now()
                            db.session.commit()

                            last_emit_time[device.id] = time_module.time()

        except Exception as e:
            print(f"❌ Monitor error: {e}")

        interval = get_setting('ping_interval', 10)
        time.sleep(interval)


def start_monitor():
    global _monitor_started
    if _monitor_started:
        print("⚠️ Мониторинг уже запущен, пропускаем")
        return
    _monitor_started = True
    socketio.start_background_task(monitor_loop)
    print("✅ Мониторинг запущен")