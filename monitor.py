import time
import threading
import concurrent.futures
import os
from extensions import db, socketio
from models import Device, Settings

# Попытка импорта ping3; если нет, будет использован fallback с subprocess
try:
    from ping3 import ping
    PING3_AVAILABLE = True
except ImportError:
    PING3_AVAILABLE = False
    import subprocess
    import platform

app_instance = None
last_emit_time = {}
_monitor_started = False
_lock = threading.Lock()  # для синхронизации last_emit_time


def init_monitor(app):
    global app_instance
    app_instance = app


def ping_host(ip, count=1):
    """
    Возвращает True, если устройство доступно (хотя бы один пакет успешен).
    Использует ping3, если доступен, иначе subprocess.
    """
    if PING3_AVAILABLE:
        # ping3.ping() возвращает время ответа (float) или None при таймауте/ошибке
        # Эмулируем count попыток с интервалом 0.2 сек
        for _ in range(count):
            try:
                response_time = ping(ip, timeout=2)  # таймаут 2 секунды на попытку
                if response_time is not None:
                    return True
            except Exception:
                continue
            time.sleep(0.2)
        return False
    else:
        # fallback: используем subprocess
        param = '-n' if platform.system().lower() == 'windows' else '-c'
        # В Linux ping -c count -W timeout (в секундах)
        # В Windows ping -n count -w timeout (в миллисекундах)
        timeout_seconds = 2
        try:
            # Формируем команду
            if platform.system().lower() == 'windows':
                # Windows таймаут в миллисекундах
                cmd = ['ping', param, str(count), '-w', str(timeout_seconds * 1000), ip]
            else:
                # Linux: -W timeout (секунды)
                cmd = ['ping', param, str(count), '-W', str(timeout_seconds), ip]
            output = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    timeout=timeout_seconds * count + 2)
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
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        print("⚙️ Релоадер: монитор запущен в основном процессе")
    else:
        print("⚙️ Монитор запущен")

    while True:
        try:
            with app_instance.app_context():
                devices = Device.query.all()
                if not devices:
                    time.sleep(5)
                    continue

                ping_count = get_setting('ping_count', 4)
                # Количество потоков: не более 50, но и не больше числа устройств
                max_workers = min(50, len(devices))

                results = []  # список кортежей (device, is_up)

                # Функция для проверки одного устройства
                def check_device(dev):
                    if dev.ip_address:
                        is_up = ping_host(dev.ip_address, ping_count)
                        return dev, is_up
                    return dev, None

                # Параллельная проверка
                with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                    future_to_dev = {executor.submit(check_device, dev): dev for dev in devices}
                    for future in concurrent.futures.as_completed(future_to_dev):
                        try:
                            dev, is_up = future.result()
                            if is_up is not None:
                                results.append((dev, is_up))
                        except Exception as e:
                            print(f"❌ Ошибка при проверке {future_to_dev[future].id}: {e}")

                # Последовательная обработка результатов (обновление БД, отправка событий)
                for device, is_up in results:
                    import time as time_module
                    current_time = time_module.time()
                    with _lock:
                        last_time = last_emit_time.get(device.id, 0)
                        if current_time - last_time < 0.5:
                            continue
                        if device.status != is_up:
                            room_name = f'map_{device.map_id}'
                            status_str = 'true' if is_up else 'false'

                            socketio.emit('device_status', {
                                'id': device.id,
                                'status': status_str,
                                'map_id': device.map_id
                            }, room=room_name)

                            status_display = "UP ✅" if is_up else "DOWN ❌"
                            print(f"📤 [{status_display}] Отправлено: id={device.id}, status={status_str}, room={room_name}")

                            # Обновляем БД
                            device.status = is_up
                            device.last_check = db.func.now()
                            db.session.commit()

                            last_emit_time[device.id] = current_time

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