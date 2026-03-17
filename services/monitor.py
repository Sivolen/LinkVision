import asyncio
import time
import threading
import os
from extensions import db, socketio
from models import Device, Settings, DeviceHistory
from utils.logger import monitor_logger
from cachetools import TTLCache

try:
    from aioping import ping
    PING_AVAILABLE = True
except ImportError:
    PING_AVAILABLE = False
    # fallback – используем asyncio.subprocess для системного ping
    import asyncio.subprocess

app_instance = None
last_emit_time = {}
_monitor_started = False
_lock = threading.Lock()
_loop = None
_loop_thread = None

# Кэш настроек с TTL 2 секунды
settings_cache = TTLCache(maxsize=10, ttl=2)


def init_monitor(app):
    global app_instance, _loop, _loop_thread
    app_instance = app
    # Запускаем асинхронный цикл в отдельном потоке
    _loop = asyncio.new_event_loop()
    _loop_thread = threading.Thread(target=_run_loop, args=(_loop,), daemon=True)
    _loop_thread.start()
    monitor_logger.info("Async monitor loop started")


def _run_loop(loop):
    asyncio.set_event_loop(loop)
    loop.run_forever()


def stop_monitor():
    global _loop, _monitor_started
    if _loop and _loop.is_running():
        _loop.call_soon_threadsafe(_loop.stop)
        if _loop_thread:
            _loop_thread.join(timeout=2)
    _monitor_started = False
    monitor_logger.info("Monitor stopped")


# ---------- Синхронные обёртки с контекстом приложения ----------
def _get_devices_sync():
    """Получить все устройства с включённым мониторингом (в контексте приложения)."""
    with app_instance.app_context():
        return Device.query.filter_by(monitoring_enabled=True).all()


def _get_setting_sync(key, default):
    """Получить настройку из БД (в контексте приложения)."""
    with app_instance.app_context():
        s = Settings.query.filter_by(key=key).first()
        return int(s.value) if s else default


def _update_device_status_sync(device_id, is_up):
    """Обновить статус устройства и добавить запись в историю (в контексте приложения)."""
    with app_instance.app_context():
        device = Device.query.get(device_id)
        if not device:
            monitor_logger.error(f"Device {device_id} not found during status update")
            return
        device.status = is_up
        device.last_check = db.func.now()
        history_entry = DeviceHistory(
            device_id=device.id,
            old_status=not is_up,
            new_status=is_up
        )
        db.session.add(history_entry)
        db.session.commit()
        monitor_logger.debug(f"DB updated: device {device_id} status -> {is_up}")
# ----------------------------------------------------------------

async def ping_host(ip, count=1):
    """Асинхронный пинг с помощью aioping или системного ping."""
    if PING_AVAILABLE:
        for _ in range(count):
            try:
                # aioping.ping возвращает время в секундах или None при таймауте
                response_time = await ping(ip, timeout=2)
                if response_time is not None:
                    return True
            except Exception:
                continue
            await asyncio.sleep(0.2)
        return False
    else:
        # fallback: используем asyncio.create_subprocess_exec
        param = '-n' if os.name == 'nt' else '-c'
        timeout_seconds = 2
        for _ in range(count):
            try:
                if os.name == 'nt':
                    cmd = ['ping', param, '1', '-w', str(timeout_seconds * 1000), ip]
                else:
                    cmd = ['ping', param, '1', '-W', str(timeout_seconds), ip]
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                try:
                    await asyncio.wait_for(proc.wait(), timeout=timeout_seconds + 1)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                    continue
                if proc.returncode == 0:
                    return True
            except Exception:
                continue
            await asyncio.sleep(0.2)
        return False


async def get_setting_async(key, default):
    """Получить настройку из кэша или БД (асинхронно)."""
    cache_key = f"setting_{key}"
    if cache_key in settings_cache:
        return settings_cache[cache_key]

    value = await asyncio.to_thread(_get_setting_sync, key, default)
    settings_cache[cache_key] = value
    return value


async def _check_device(dev, ping_count):
    """Проверить одно устройство."""
    is_up = await ping_host(dev.ip_address, ping_count)
    return dev, is_up


async def _process_result(device, is_up):
    """Обработать результат пинга, обновить статус и отправить событие."""
    import time as time_module
    current_time = time_module.time()
    with _lock:
        last_time = last_emit_time.get(device.id, 0)
        if current_time - last_time < 0.5:
            return
        if device.status != is_up:
            # Обновляем БД в отдельном потоке с контекстом
            await asyncio.to_thread(_update_device_status_sync, device.id, is_up)

            # Отправляем событие
            room_name = f'map_{device.map_id}'
            status_str = 'true' if is_up else 'false'
            socketio.emit('device_status', {
                'id': device.id,
                'status': status_str,
                'map_id': device.map_id
            }, room=room_name)

            monitor_logger.info(
                f"[{'UP' if is_up else 'DOWN'}] Sent: id={device.id}, status={status_str}, room={room_name}"
            )
            last_emit_time[device.id] = current_time
        else:
            monitor_logger.debug(f"No status change for device {device.id}")


async def monitor_iteration():
    """Одна итерация мониторинга (асинхронная)."""
    global last_emit_time
    start_time = time.time()
    try:
        # Получаем устройства (синхронно в потоке с контекстом)
        devices = await asyncio.to_thread(_get_devices_sync)
        monitor_logger.debug(f"Fetched {len(devices)} devices from DB")
        if not devices:
            await asyncio.sleep(5)
            return

        ping_count = await get_setting_async('ping_count', 4)
        tasks = []
        for dev in devices:
            monitor_logger.debug(f"Device {dev.id} current status: {dev.status}")
            if dev.ip_address:
                tasks.append(_check_device(dev, ping_count))
            # Если нет IP – пропускаем (статус не меняем)

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Обрабатываем результаты
        for res in results:
            if isinstance(res, Exception):
                monitor_logger.error(f"Error in ping task: {res}")
                continue
            if res is None:
                continue
            device, is_up = res
            await _process_result(device, is_up)

    except Exception as e:
        monitor_logger.error(f"Monitor iteration error: {e}")

    elapsed = time.time() - start_time
    interval = await get_setting_async('ping_interval', 10)
    if elapsed > interval * 0.5:
        monitor_logger.warning(f"Monitor cycle took {elapsed:.2f}s (interval {interval}s)")
    return elapsed, interval


async def monitor_loop():
    """Основной асинхронный цикл мониторинга."""
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        monitor_logger.debug("Reloader: monitor started in main process")
    else:
        monitor_logger.debug("Monitor started")

    while True:
        try:
            elapsed, interval = await monitor_iteration()
        except Exception as e:
            monitor_logger.error(f"Unhandled error in monitor loop: {e}")
            elapsed = 0
            interval = 10
        sleep_time = max(0, interval - elapsed)
        await asyncio.sleep(sleep_time)


def start_monitor():
    global _monitor_started
    if _monitor_started:
        monitor_logger.warning("Monitor already started, skipping")
        return
    _monitor_started = True
    # Запускаем корутину в существующем цикле событий
    asyncio.run_coroutine_threadsafe(monitor_loop(), _loop)
    monitor_logger.info("Monitor started")