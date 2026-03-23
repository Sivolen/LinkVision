import atexit
import secrets
from pathlib import Path

from flask import Flask, request
from flask_socketio import join_room
from config import Config
from extensions import db, login_manager, socketio, init_extensions
from models import User, DeviceType, Settings
from blueprints.auth import auth_bp
from blueprints.admin import admin_bp
from blueprints.main import main_bp
from blueprints.api import api_bp
from services.monitor import init_monitor, start_monitor, stop_monitor
from utils.logger import app_logger
from dotenv import load_dotenv
import os


def ensure_env_file():
    """Создаёт или дополняет .env необходимыми переменными (продакшен-конфигурация)."""
    env_path = Path('.env')
    required_vars = {
        'SECRET_KEY': secrets.token_hex(32),
        'SESSION_COOKIE_SECURE': 'True',      # Безопасность: только HTTPS
        'BEHIND_PROXY': 'True',               # Приложение работает за прокси (nginx)
        'LOG_LEVEL': 'INFO',
    }

    if not env_path.exists():
        with open(env_path, 'w') as f:
            for key, value in required_vars.items():
                f.write(f"{key}={value}\n")
        app_logger.info(f"Файл .env создан с переменными для продакшена: {', '.join(required_vars.keys())}")
        load_dotenv(env_path)
        return

    load_dotenv(env_path)

    missing = []
    for key, default in required_vars.items():
        if os.environ.get(key) is None:
            missing.append((key, default))

    if missing:
        with open(env_path, 'a') as f:
            for key, default in missing:
                f.write(f"{key}={default}\n")
        load_dotenv(env_path, override=True)
        app_logger.info(f"В .env добавлены переменные: {', '.join(k for k, _ in missing)}")


ensure_env_file()


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    init_extensions(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    with app.app_context():
        db.create_all()

        # --- Создание администратора, если ни одного нет ---
        if not User.query.filter_by(is_admin=True).first():
            import secrets
            admin = User(username='admin', is_admin=True)
            # default_password = secrets.token_urlsafe(8)  # случайный пароль
            default_password = "Admin"
            admin.set_password(default_password)
            db.session.add(admin)
            db.session.commit()
            app_logger.info(f"✅ Создан администратор: admin / {default_password}")

        # --- Настройки мониторинга, если ещё не заданы ---
        if not db.session.get(Settings, 'ping_count'):
            db.session.add(Settings(key='ping_count', value='4'))
        if not db.session.get(Settings, 'ping_interval'):
            db.session.add(Settings(key='ping_interval', value='10'))

        # --- Дефолтные типы устройств, если таблица пуста ---
        if not DeviceType.query.first():
            default_types = ['Router', 'Switch', 'Server', 'PC']
            for name in default_types:
                db.session.add(DeviceType(name=name, icon_filename=''))
            app_logger.info("✅ Добавлены стандартные типы устройств")

        db.session.commit()

        init_monitor(app)

    @socketio.on('join_room')
    def handle_join_room(room):
        join_room(room)
        app_logger.info(f"✅ Клиент присоединился к комнате {room}")

    @socketio.on('connect')
    def handle_connect():
        app_logger.info(f"✅ Клиент подключился: {request.sid}")  # type: ignore

    @socketio.on('disconnect')
    def handle_disconnect():
        app_logger.info(f"❌ Клиент отключился: {request.sid}")  # type: ignore

    start_monitor()
    atexit.register(stop_monitor)

    @app.route('/static/uploads/maps/<path:filename>')
    def serve_map_background(filename):
        from flask import send_from_directory
        maps_dir = os.path.join(app.root_path, 'static', 'uploads', 'maps')
        return send_from_directory(maps_dir, filename)

    @app.route('/static/uploads/icons/<path:filename>')
    def serve_icon(filename):
        from flask import send_from_directory
        icons_dir = os.path.join(app.root_path, 'static', 'uploads', 'icons')
        return send_from_directory(icons_dir, filename)

    @app.context_processor
    def inject_globals():
        from config import Config
        return {
            'app_version': Config.VERSION,
            'debug_mode': app.debug
        }

    return app


if __name__ == '__main__':
    os.makedirs('static/uploads/icons', exist_ok=True)
    application = create_app()
    socketio.run(application, debug=True, use_reloader=False, port=5000, host="0.0.0.0", allow_unsafe_werkzeug=True)
