import time
import threading
import concurrent.futures
import os
from extensions import db, socketio
from models import Device, Settings, DeviceHistory
from utils.logger import monitor_logger
from cachetools import TTLCache

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
_monitor_stop_flag = False  # флаг для остановки
_lock = threading.Lock()
_executor = None  # переиспользуемый пул

# Кэш настроек с TTL 2 секунды
settings_cache = TTLCache(maxsize=10, ttl=2)


def init_monitor(app):
    global app_instance, _executor
    app_instance = app

    # Закрываем старый executor, если он существует
    if _executor is not None:
        _executor.shutdown(wait=False)
        _executor = None

    _executor = concurrent.futures.ThreadPoolExecutor(max_workers=50)


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
    cache_key = f"setting_{key}"
    if cache_key in settings_cache:
        return settings_cache[cache_key]

    if app_instance:
        with app_instance.app_context():
            s = Settings.query.filter_by(key=key).first()
            value = int(s.value) if s else default
            settings_cache[cache_key] = value
            return value
    return default


def monitor_loop():
    global last_emit_time, _monitor_stop_flag
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        monitor_logger.debug("Reloader: monitor started in main process")
    else:
        monitor_logger.debug("Monitor started")

    while not _monitor_stop_flag:
        start_time = time.time()
        try:
            if app_instance is None or _executor is None:
                monitor_logger.error("Monitor not properly initialized")
                time.sleep(5)
                continue

            with app_instance.app_context():
                devices = Device.query.filter_by(monitoring_enabled=True).all()
                if not devices:
                    time.sleep(5)
                    continue

                ping_count = get_setting('ping_count', 4)
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

                devices_to_update = []
                history_entries = []

                for device, device_is_up in results:
                    current_time = time.time()
                    with _lock:
                        last_time = last_emit_time.get(device.id, 0)
                        if current_time - last_time < 0.5:
                            continue
                        if device.status != device_is_up:
                            devices_to_update.append((device, device_is_up))
                            old_status = device.status
                            history_entries.append(DeviceHistory(
                                device_id=device.id,
                                old_status=old_status,
                                new_status=device_is_up
                            ))
                            last_emit_time[device.id] = current_time

                if devices_to_update:
                    for device, device_is_up in devices_to_update:
                        device.status = device_is_up
                        device.last_check = db.func.now()
                    db.session.add_all(history_entries)
                    db.session.commit()

                    for device, device_is_up in devices_to_update:
                        room_name = f'map_{device.map_id}'
                        status_str = 'true' if device_is_up else 'false'
                        socketio.emit('device_status', {
                            'id': device.id,
                            'status': status_str,
                            'map_id': device.map_id
                        }, room=room_name)
                        monitor_logger.info(
                            f"[{'UP' if device_is_up else 'DOWN'}] Sent: id={device.id}, status={status_str}, room={room_name}"
                        )

        except Exception as e:
            monitor_logger.error(f"Monitor error: {e}")

        elapsed = time.time() - start_time
        interval = get_setting('ping_interval', 10)
        if elapsed > interval * 0.5:
            monitor_logger.warning(f"Monitor cycle took {elapsed:.2f}s (interval {interval}s)")
        time.sleep(max(0, interval - elapsed))


def start_monitor():
    global _monitor_started, _monitor_stop_flag
    if _monitor_started:
        monitor_logger.warning("Monitor already started, skipping")
        return
    _monitor_stop_flag = False
    _monitor_started = True
    socketio.start_background_task(monitor_loop)
    monitor_logger.info("Monitor started")


def stop_monitor():
    global _monitor_stop_flag, _monitor_started, _executor
    _monitor_stop_flag = True
    _monitor_started = False

    if _executor is not None:
        _executor.shutdown(wait=False)   # не блокируем, пусть завершится в фоне
        _executor = None

    monitor_logger.info("Monitor stopped")
