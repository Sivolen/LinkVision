import time
import threading
import concurrent.futures
import os
from extensions import db, socketio
from models import Device, Settings, DeviceHistory
from logger import monitor_logger

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


def init_monitor(app):
    global app_instance
    app_instance = app


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
        try:
            with app_instance.app_context():
                devices = Device.query.all()
                if not devices:
                    time.sleep(5)
                    continue

                ping_count = get_setting('ping_count', 4)
                max_workers = min(50, len(devices))

                results = []

                def check_device(dev):
                    if dev.ip_address:
                        is_up = ping_host(dev.ip_address, ping_count)
                        return dev, is_up
                    return dev, None

                with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                    future_to_dev = {executor.submit(check_device, dev): dev for dev in devices}
                    for future in concurrent.futures.as_completed(future_to_dev):
                        try:
                            dev, is_up = future.result()
                            if is_up is not None:
                                results.append((dev, is_up))
                        except Exception as e:
                            monitor_logger.error(f"Error checking device {future_to_dev[future].id}: {e}")

                for device, is_up in results:
                    if not device.monitoring_enabled:
                        continue
                    import time as time_module
                    current_time = time_module.time()
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
                            db.session.add(history_entry)

                            db.session.commit()

                            socketio.emit('device_status', {
                                'id': device.id,
                                'status': status_str,
                                'map_id': device.map_id
                            }, room=room_name)

                            status_display = "UP ✅" if is_up else "DOWN ❌"
                            monitor_logger.info(
                                f"[{status_display}] Sent: id={device.id}, status={status_str}, room={room_name}"
                            )

                            last_emit_time[device.id] = current_time

        except Exception as e:
            monitor_logger.error(f"Monitor error: {e}")

        interval = get_setting('ping_interval', 10)
        time.sleep(interval)


def start_monitor():
    global _monitor_started
    if _monitor_started:
        monitor_logger.warning("Monitor already started, skipping")
        return
    _monitor_started = True
    socketio.start_background_task(monitor_loop)
    monitor_logger.info("Monitor started")