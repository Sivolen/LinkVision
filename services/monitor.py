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
_monitor_stop_flag = False
_lock = threading.Lock()
_executor = None
settings_cache = TTLCache(maxsize=10, ttl=2)


def init_monitor(app):
    global app_instance, _executor
    app_instance = app
    if _executor is not None:
        try:
            _executor.shutdown(wait=True)
        except:
            pass
        _executor = None
    _executor = concurrent.futures.ThreadPoolExecutor(max_workers=20)
    monitor_logger.info("Monitor initialized with new executor")


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
        param = "-n" if platform.system().lower() == "windows" else "-c"
        timeout_seconds = 2
        try:
            if platform.system().lower() == "windows":
                cmd = ["ping", param, str(count), "-w", str(timeout_seconds * 1000), ip]
            else:
                cmd = ["ping", param, str(count), "-W", str(timeout_seconds), ip]
            output = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout_seconds * count + 2,
            )
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


def check_device(device_id, app):
    with app.app_context():
        device = Device.query.get(device_id)
        if not device:
            return device_id, "down"
        if not device.monitoring_enabled or not device.ips:
            return device_id, "down"
        ping_count = get_setting("ping_count", 4)
        results = []
        for ip_obj in device.ips:
            is_up = ping_host(ip_obj.ip_address, ping_count)
            results.append(is_up)
        if all(results):
            new_status = "up"
        elif any(results):
            new_status = "partial"
        else:
            new_status = "down"
        return device_id, new_status


def monitor_loop():
    global last_emit_time, _monitor_stop_flag, _executor
    monitor_logger.debug("Monitor loop started")
    cycle_count = 0
    while not _monitor_stop_flag:
        cycle_count += 1
        start_time = time.time()
        monitor_logger.debug(f"Monitor cycle {cycle_count} starting")
        try:
            if app_instance is None or _executor is None:
                monitor_logger.error("Monitor not properly initialized")
                time.sleep(5)
                continue

            # Получаем список устройств
            with app_instance.app_context():
                devices = [d for d in Device.query.all() if d.monitoring_enabled]
                monitor_logger.info(
                    f"Found {len(devices)} devices with monitoring enabled"
                )
                if not devices:
                    time.sleep(5)
                    continue

            # Запускаем проверку
            futures = {
                _executor.submit(check_device, dev.id, app_instance): dev
                for dev in devices
            }
            results = []
            for future in concurrent.futures.as_completed(futures):
                try:
                    device_id, new_status = future.result()
                    dev = futures[future]
                    results.append((dev, new_status))
                except Exception as e:
                    monitor_logger.error(f"Error checking device: {e}")

            # Обработка изменений
            devices_to_update = []
            history_entries = []
            current_time = time.time()
            with _lock:
                for device, new_status in results:
                    last_time = last_emit_time.get(device.id, 0)
                    if current_time - last_time < 0.5:
                        continue
                    if device.status != new_status:
                        devices_to_update.append((device, new_status))
                        history_entries.append(
                            DeviceHistory(
                                device_id=device.id,
                                old_status=device.status,
                                new_status=new_status,
                            )
                        )
                        last_emit_time[device.id] = current_time
                        monitor_logger.info(
                            f"Device {device.id} status change: {device.status} -> {new_status}"
                        )

            if devices_to_update:
                with app_instance.app_context():
                    for device, new_status in devices_to_update:
                        dev = Device.query.get(device.id)
                        if dev:
                            dev.status = new_status
                            dev.last_check = db.func.now()
                    db.session.add_all(history_entries)
                    db.session.commit()

                    for device, new_status in devices_to_update:
                        room_name = f"map_{device.map_id}"
                        socketio.emit(
                            "device_status",
                            {
                                "id": device.id,
                                "status": new_status,
                                "map_id": device.map_id,
                            },
                            room=room_name,
                        )
                        monitor_logger.info(
                            f"[{new_status.upper()}] Sent: id={device.id}, status={new_status}, room={room_name}"
                        )
            else:
                monitor_logger.debug("No status changes this cycle")

        except Exception as e:
            monitor_logger.error(f"Monitor error: {e}")
            import traceback

            monitor_logger.error(traceback.format_exc())

        elapsed = time.time() - start_time
        interval = get_setting("ping_interval", 10)
        sleep_time = max(0, interval - elapsed)
        monitor_logger.debug(
            f"Cycle completed in {elapsed:.2f}s, sleeping {sleep_time:.2f}s"
        )
        time.sleep(sleep_time)

    monitor_logger.info("Monitor loop terminated")


def start_monitor():
    global _monitor_started, _monitor_stop_flag, _executor
    if _monitor_started:
        monitor_logger.warning("Monitor already started, skipping")
        return
    if _executor is None and app_instance:
        init_monitor(app_instance)
    _monitor_stop_flag = False
    _monitor_started = True
    socketio.start_background_task(monitor_loop)
    monitor_logger.info("Monitor started")


def stop_monitor():
    global _monitor_stop_flag, _monitor_started, _executor
    _monitor_stop_flag = True
    _monitor_started = False
    if _executor is not None:
        _executor.shutdown(wait=True)
        _executor = None
    monitor_logger.info("Monitor stopped")
