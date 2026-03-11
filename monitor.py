import time
import platform
import subprocess
import threading
from extensions import db, socketio
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
                        if device.status != is_up:
                            device.status = is_up
                            device.last_check = db.func.now()
                            db.session.commit()
                            # Небольшая задержка для гарантии
                            time.sleep(0.1)
                            socketio.emit('device_status', {
                                'id': device.id,
                                'status': is_up,
                                'map_id': device.map_id
                            })
                            print(f"📤 Отправлено device_status: id={device.id}, status={is_up}")
        except Exception as e:
            print(f"Monitor error: {e}")
        time.sleep(10)

def start_monitor():
    thread = threading.Thread(target=monitor_loop, daemon=True)
    thread.start()