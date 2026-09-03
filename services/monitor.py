import time
import datetime
import threading
import concurrent.futures
import os
import subprocess
import platform
import traceback
from extensions import db, socketio
from models import Device, Settings, DeviceHistory
from utils.logger import monitor_logger
from cachetools import TTLCache
from sqlalchemy.orm import joinedload

try:
    from ping3 import ping

    PING3_AVAILABLE = True
except ImportError:
    PING3_AVAILABLE = False

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
            try:
                _executor.shutdown(wait=False)
            except Exception:
                pass
        app_instance = app
        max_workers = min(50, (os.cpu_count() or 1) * 4)
        _executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        monitor_logger.info(f"Monitor initialized with {max_workers} workers")


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
        successful_pings = 0
        for i in range(count):
            try:
                response_time = ping(ip, timeout=2)
                if response_time is not None:
                    successful_pings += 1
                if i < count - 1:
                    time.sleep(0.5)
            except Exception:
                continue
        return successful_pings > 0
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
                timeout=timeout_seconds * count + 5,
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
                devices = (
                    Device.query.options(joinedload(Device.ips))
                    .filter_by(monitoring_enabled=True)
                    .all()
                )
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
                    if is_up:
                        break
                if all(results):
                    return dev_id, "up"
                elif any(results):
                    return dev_id, "partial"
                else:
                    return dev_id, "down"

            # ---- РАЗБИЕНИЕ НА БАТЧИ ДЛЯ ИЗБЕЖАНИЯ ПЕРЕГРУЗКИ ----
            batch_size = 50
            all_device_checks = [
                (dev.id, device_ips[dev.id], ping_count) for dev in devices
            ]

            results = []
            for batch_start in range(0, len(all_device_checks), batch_size):
                batch_checks = all_device_checks[batch_start : batch_start + batch_size]

                # Проверка состояния пула перед отправкой задач
                with _lock:
                    if _executor is None:
                        max_workers = min(50, (os.cpu_count() or 1) * 4)
                        _executor = concurrent.futures.ThreadPoolExecutor(
                            max_workers=max_workers
                        )
                        monitor_logger.info(
                            f"Executor recreated with {max_workers} workers"
                        )

                futures = {}
                for dev_id, ips, pcnt in batch_checks:
                    try:
                        future = _executor.submit(_check_device, dev_id, ips, pcnt)
                        futures[future] = dev_id
                    except RuntimeError as e:
                        monitor_logger.error(
                            f"Failed to submit check for device {dev_id}: {e}"
                        )
                        # Попытка переинициализировать пул
                        with _lock:
                            try:
                                if _executor is not None:
                                    _executor.shutdown(wait=False)
                            except Exception:
                                pass
                            max_workers = min(50, (os.cpu_count() or 1) * 4)
                            _executor = concurrent.futures.ThreadPoolExecutor(
                                max_workers=max_workers
                            )
                            monitor_logger.info(
                                f"Executor recreated after error with {max_workers} workers"
                            )
                        continue

                for future in concurrent.futures.as_completed(
                    futures, timeout=ping_interval * 2
                ):
                    try:
                        dev_id, new_status = future.result(timeout=10)
                        results.append((dev_id, new_status))
                    except concurrent.futures.TimeoutError:
                        dev_id = futures.get(future, "unknown")
                        monitor_logger.warning(
                            f"Timeout checking device {dev_id}, marking as down"
                        )
                        results.append((dev_id, "down"))
                    except Exception as e:
                        dev_id = futures.get(future, "unknown")
                        monitor_logger.error(f"Error checking device {dev_id}: {e}")
                        results.append((dev_id, "down"))

                time.sleep(0.5)

            # ---- ОБРАБОТКА ИЗМЕНЕНИЙ ----
            current_time = time.time()
            # Сгруппируем emit по комнатам карт: room -> список статусов
            emits_by_room = {}

            with _lock, app_instance.app_context():
                # Одним запросом тянем все затронутые устройства
                changed_ids = [
                    dev_id
                    for dev_id, _ in results
                    if current_time - last_emit_time.get(dev_id, 0) >= 0.5
                ]
                if changed_ids:
                    devices_by_id = {
                        d.id: d
                        for d in Device.query.filter(Device.id.in_(changed_ids)).all()
                    }

                    history_entries = []
                    for dev_id, new_status in results:
                        if current_time - last_emit_time.get(dev_id, 0) < 0.5:
                            continue
                        device = devices_by_id.get(dev_id)
                        if not device or device.status == new_status:
                            continue

                        history_entries.append(
                            DeviceHistory(
                                device_id=device.id,
                                old_status=device.status,
                                new_status=new_status,
                            )
                        )
                        device.status = new_status
                        device.last_check = datetime.datetime.now()
                        last_emit_time[dev_id] = current_time

                        room = f"map_{device.map_id}"
                        emits_by_room.setdefault(room, []).append(
                            {
                                "id": device.id,
                                "status": new_status,
                                "map_id": device.map_id,
                            }
                        )
                        monitor_logger.info(
                            f"Device {dev_id} status change -> {new_status}"
                        )

                    if history_entries:
                        db.session.add_all(history_entries)
                        db.session.commit()

            # Emit ОДНИМ сообщением на комнату
            for room, statuses in emits_by_room.items():
                socketio.emit("device_status_batch", statuses, room=room)

            if not emits_by_room:
                monitor_logger.debug("No status changes this cycle")

        except Exception as e:
            monitor_logger.error(f"Monitor error: {e}")
            monitor_logger.error(traceback.format_exc())

        elapsed = time.time() - start_time
        sleep_time = max(0, ping_interval - elapsed)
        monitor_logger.debug(
            f"Cycle completed in {elapsed:.2f}s, sleeping {sleep_time:.2f}s"
        )
        time.sleep(sleep_time)

    monitor_logger.info("Monitor loop terminated")
