import atexit
import secrets
from pathlib import Path

from flask import Flask, request, render_template, jsonify
from flask_login import current_user
from flask_migrate import Migrate
from flask_socketio import join_room
from flask_wtf.csrf import CSRFProtect
from sqlalchemy import event
from werkzeug.middleware.proxy_fix import ProxyFix

from config import Config
from extensions import db, login_manager, socketio, init_extensions
from models import User, DeviceType, Settings
from blueprints.auth import auth_bp
from blueprints.admin import admin_bp
from blueprints.main import main_bp
from blueprints.api import api_bp
from services.monitor import init_monitor, start_monitor, stop_monitor
from services.permissions import can_view_map
from utils.logger import app_logger
from dotenv import load_dotenv
import os


def ensure_env_file():
    """Создаёт или дополняет .env необходимыми переменными (продакшен-конфигурация)."""
    env_path = Path(".env")
    required_vars = {
        "SECRET_KEY": secrets.token_hex(32),
        "SESSION_COOKIE_SECURE": "True",  # Безопасность: только HTTPS
        "BEHIND_PROXY": "True",  # Приложение работает за прокси (nginx)
        "LOG_LEVEL": "INFO",
    }

    if not env_path.exists():
        with open(env_path, "w") as f:
            for key, value in required_vars.items():
                f.write(f"{key}={value}\n")
        app_logger.info(
            f"Файл .env создан с переменными для продакшена: {', '.join(required_vars.keys())}"
        )
        load_dotenv(env_path)
        return

    load_dotenv(env_path)

    missing = []
    for key, default in required_vars.items():
        if os.environ.get(key) is None:
            missing.append((key, default))

    if missing:
        with open(env_path, "a") as f:
            for key, default in missing:
                f.write(f"{key}={default}\n")
        load_dotenv(env_path, override=True)
        app_logger.info(
            f"В .env добавлены переменные: {', '.join(k for k, _ in missing)}"
        )


ensure_env_file()


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    # Отключаем кэширование шаблонов в debug режиме
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
    csrf = CSRFProtect(app)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    init_extensions(app)

    migrate = Migrate(app, db)

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    # Отключаем CSRF для API endpoints (используем сессионную аутентификацию)
    csrf.exempt(api_bp)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    with app.app_context():
        # db.create_all()
        if "sqlite" in app.config["SQLALCHEMY_DATABASE_URI"]:

            @event.listens_for(db.engine, "connect")
            def set_sqlite_pragma(dbapi_connection, connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

        # --- Создание администратора, если ни одного нет ---
        if not User.query.filter_by(is_admin=True).first():
            admin = User(username="admin", is_admin=True)
            default_password = secrets.token_urlsafe(16)
            admin.set_password(default_password)
            admin.must_change_password = True
            db.session.add(admin)
            db.session.commit()
            app_logger.warning(
                f"✅ Создан администратор admin. Временный пароль: {default_password}"
            )

        # --- Настройки мониторинга, если ещё не заданы ---
        if not db.session.get(Settings, "ping_count"):
            db.session.add(Settings(key="ping_count", value="4"))
        if not db.session.get(Settings, "ping_interval"):
            db.session.add(Settings(key="ping_interval", value="10"))

        # --- Дефолтные типы устройств, если таблица пуста ---
        if not DeviceType.query.first():
            default_types = ["Router", "Switch", "Server", "PC"]
            for name in default_types:
                db.session.add(DeviceType(name=name, icon_filename=""))
            app_logger.info("✅ Добавлены стандартные типы устройств")

        db.session.commit()

        init_monitor(app)

    @socketio.on("join_room")
    def handle_join_room(room):
        if not current_user.is_authenticated:
            return

        # комнаты вида "map_<id>"
        try:
            map_id = int(str(room).split("_", 1)[1])
        except (IndexError, ValueError):
            app_logger.warning(f"Отклонён вход в комнату с некорректным именем: {room}")
            return

        if not can_view_map(map_id):
            app_logger.warning(
                f"Пользователь {current_user.id} отклонён при входе в {room}"
            )
            return

        join_room(room)
        app_logger.info(f"✅ Клиент присоединился к комнате {room}")

    @socketio.on("connect")
    def handle_connect():
        app_logger.info(f"✅ Клиент подключился: {request.sid}")  # type: ignore

    @socketio.on("disconnect")
    def handle_disconnect():
        app_logger.info(f"❌ Клиент отключился: {request.sid}")  # type: ignore

    start_monitor()
    atexit.register(stop_monitor)

    @app.route("/static/uploads/maps/<path:filename>")
    def serve_map_background(filename):
        from flask import send_from_directory

        maps_dir = os.path.join(app.root_path, "static", "uploads", "maps")
        return send_from_directory(maps_dir, filename)

    @app.route("/static/uploads/icons/<path:filename>")
    def serve_icon(filename):
        from flask import send_from_directory

        icons_dir = os.path.join(app.root_path, "static", "uploads", "icons")
        return send_from_directory(icons_dir, filename)

    @app.context_processor
    def inject_globals():
        from config import Config
        from flask_wtf.csrf import generate_csrf

        return {
            "app_version": Config.VERSION,
            "debug_mode": app.debug,
            "csrf_token": lambda: generate_csrf(),
        }

    @app.errorhandler(404)
    def page_not_found(e):
        return render_template("404.html", hide_sidebar=True), 404

    @app.errorhandler(Exception)
    def handle_unexpected(e):
        from werkzeug.exceptions import HTTPException
        if isinstance(e, HTTPException):
            return e
        app_logger.exception("Unhandled exception")
        return jsonify({"error": "Внутренняя ошибка сервера"}), 500

    @socketio.on("request_status")
    def handle_request_status(data):
        map_id = data.get("map_id")
        if not map_id or not current_user.is_authenticated or not can_view_map(map_id):
            return

        from models import Device

        with app.app_context():
            devices = Device.query.filter_by(
                map_id=map_id, monitoring_enabled=True
            ).all()
            statuses = [{"id": d.id, "status": d.status} for d in devices]
            socketio.emit("device_status_batch", statuses, room=f"map_{map_id}")

    return app


if __name__ == "__main__":
    os.makedirs("static/uploads/icons", exist_ok=True)
    application = create_app()
    socketio.run(
        application,
        debug=True,
        use_reloader=False,
        port=5000,
        host="0.0.0.0",
        allow_unsafe_werkzeug=True,
    )
