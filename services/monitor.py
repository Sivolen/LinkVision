import time
import threading
import concurrent.futures
import os
from extensions import db, socketio
from models import Device, Settings, DeviceHistory
from utils.logger import monitor_logger

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
_lock = threading.Lock()
_executor = None


def init_monitor(app):
    global app_instance, _executor
    app_instance = app
    # Увеличим количество workers для масштабирования
    _executor = concurrent.futures.ThreadPoolExecutor(max_workers=100)


def ping_host(ip, count=1):
    if PING3_AVAILABLE:
        for _ in range(count):
            try:
                response_time = ping(ip, timeout=2)
                if response_time is not None:
                    return True
            except Exception:
                continue
            time.sleep(0.2)
        return False
    else:
        param = '-n' if platform.system().lower() == 'windows' else '-c'
        timeout_seconds = 2
        try:
            if platform.system().lower() == 'windows':
                cmd = ['ping', param, str(count), '-w', str(timeout_seconds * 1000), ip]
            else:
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
        monitor_logger.debug("Reloader: monitor started in main process")
    else:
        monitor_logger.debug("Monitor started")

    while True:
        start_time = time.time()
        try:
            with app_instance.app_context():
                devices = Device.query.filter_by(monitoring_enabled=True).all()
                if not devices:
                    time.sleep(5)
                    continue

                ping_count = get_setting('ping_count', 4)
                # Рекомендуется уменьшить до 2 для больших сетей
                if ping_count > 2:
                    ping_count = 2
                    monitor_logger.debug(f"Reducing ping count to 2 for performance")

                results = []

                def check_device(dev):
                    if dev.ip_address:
                        is_up = ping_host(dev.ip_address, ping_count)
                        return dev, is_up
                    return dev, None

                future_to_dev = {_executor.submit(check_device, dev): dev for dev in devices}
                for future in concurrent.futures.as_completed(future_to_dev):
                    try:
                        dev, is_up = future.result()
                        if is_up is not None:
                            results.append((dev, is_up))
                    except Exception as e:
                        monitor_logger.error(f"Error checking device {future_to_dev[future].id}: {e}")

                # Группируем изменения для массового коммита
                changes = []
                history_entries = []
                current_time = time.time()

                for device, is_up in results:
                    with _lock:
                        last_time = last_emit_time.get(device.id, 0)
                        if current_time - last_time < 0.5:
                            continue
                        if device.status != is_up:
                            room_name = f'map_{device.map_id}'
                            status_str = 'true' if is_up else 'false'

                            old_status = device.status
                            device.status = is_up
                            device.last_check = db.func.now()

                            history_entry = DeviceHistory(
                                device_id=device.id,
                                old_status=old_status,
                                new_status=is_up
                            )
                            history_entries.append(history_entry)
                            changes.append((device, is_up, room_name, status_str, current_time))

                if history_entries:
                    db.session.add_all(history_entries)
                    db.session.commit()  # Один коммит на все изменения

                for device, is_up, room_name, status_str, ts in changes:
                    socketio.emit('device_status', {
                        'id': device.id,
                        'status': status_str,
                        'map_id': device.map_id
                    }, room=room_name)
                    monitor_logger.info(
                        f"[{'UP' if is_up else 'DOWN'}] Sent: id={device.id}, status={status_str}, room={room_name}"
                    )
                    last_emit_time[device.id] = ts

        except Exception as e:
            monitor_logger.error(f"Monitor error: {e}")

        elapsed = time.time() - start_time
        interval = get_setting('ping_interval', 10)
        # Уберём предупреждение или сделаем его менее частым
        if elapsed > interval * 0.8:
            monitor_logger.warning(f"Monitor cycle took {elapsed:.2f}s (interval {interval}s)")
        time.sleep(max(0, interval - elapsed))


def start_monitor():
    global _monitor_started
    if _monitor_started:
        monitor_logger.warning("Monitor already started, skipping")
        return
    _monitor_started = True
    socketio.start_background_task(monitor_loop)
    monitor_logger.info("Monitor started")