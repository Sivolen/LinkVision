import time
import threading
import concurrent.futures
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
_monitor_thread = None
_monitor_stop_flag = False
_executor = None
_lock = threading.Lock()
settings_cache = TTLCache(maxsize=10, ttl=2)


def init_monitor(app):
    global app_instance, _executor
    with _lock:
        if _executor is not None:
            return
        app_instance = app
        _executor = concurrent.futures.ThreadPoolExecutor(max_workers=10)
        monitor_logger.info("Monitor initialized with new executor")


def start_monitor():
    global _monitor_thread, _monitor_stop_flag
    with _lock:
        if _monitor_thread and _monitor_thread.is_alive():
            monitor_logger.warning("Monitor already started, skipping")
            return
        if _executor is None:
            monitor_logger.error("Monitor not initialized, call init_monitor first")
            return
        _monitor_stop_flag = False
        _monitor_thread = threading.Thread(target=monitor_loop, daemon=True)
        _monitor_thread.start()
        monitor_logger.info("Monitor started")


def stop_monitor():
    global _monitor_stop_flag, _monitor_thread, _executor
    with _lock:
        _monitor_stop_flag = True
        if _monitor_thread and _monitor_thread.is_alive():
            _monitor_thread.join(timeout=5)
        if _executor:
            _executor.shutdown(wait=True)
            _executor = None
        _monitor_thread = None
        monitor_logger.info("Monitor stopped")


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


def monitor_loop():
    global last_emit_time, _monitor_stop_flag, _executor
    last_emit_time = {}
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

            # ---- ПОДГОТОВКА ДАННЫХ ДО ПОТОКОВ (ОДИН РАЗ ЗА ЦИКЛ) ----
            with app_instance.app_context():
                devices = Device.query.filter_by(monitoring_enabled=True).all()
                monitor_logger.info(
                    f"Found {len(devices)} devices with monitoring enabled"
                )
                if not devices:
                    time.sleep(5)
                    continue

                device_ips = {}
                for dev in devices:
                    device_ips[dev.id] = [ip.ip_address for ip in dev.ips]

                ping_count = get_setting("ping_count", 4)
                ping_interval = get_setting("ping_interval", 10)

            # ---- ФУНКЦИЯ ПРОВЕРКИ ----
            def _check_device(dev_id, ips, pcnt):
                if not ips:
                    return dev_id, "down"
                results = []
                for ip in ips:
                    is_up = ping_host(ip, pcnt)
                    results.append(is_up)
                if all(results):
                    return dev_id, "up"
                elif any(results):
                    return dev_id, "partial"
                else:
                    return dev_id, "down"

            # ---- ЗАПУСК ПРОВЕРОК В ПОТОКАХ ----
            futures = {}
            for dev in devices:
                try:
                    future = _executor.submit(
                        _check_device, dev.id, device_ips[dev.id], ping_count
                    )
                    futures[future] = dev
                except RuntimeError as e:
                    monitor_logger.error(
                        f"Failed to submit check for device {dev.id}: {e}"
                    )
                    continue

            results = []
            for future in concurrent.futures.as_completed(futures):
                try:
                    dev_id, new_status = future.result()
                    dev = futures[future]
                    results.append((dev, new_status))
                except Exception as e:
                    monitor_logger.error(f"Error checking device: {e}")

            # ---- ОБРАБОТКА ИЗМЕНЕНИЙ ----
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
        sleep_time = max(0, ping_interval - elapsed)
        monitor_logger.debug(
            f"Cycle completed in {elapsed:.2f}s, sleeping {sleep_time:.2f}s"
        )
        time.sleep(sleep_time)

    monitor_logger.info("Monitor loop terminated")
