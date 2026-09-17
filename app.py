import atexit
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

# Load .env before importing Config/logger: those modules read environment
# variables at import time. This is essential for SECRET_KEY, database and
# production cookie/proxy settings to actually take effect on first startup.
ENV_PATH = Path(__file__).resolve().parent / ".env"


def ensure_env_file():
    """Create/load .env before project modules read Config at import time."""
    required_vars = {
        "SECRET_KEY": secrets.token_hex(32),
        # Standalone HTTP works by default. Production HTTPS deployments should
        # set SESSION_COOKIE_SECURE=True and BEHIND_PROXY=True explicitly.
        "SESSION_COOKIE_SECURE": "False",
        "BEHIND_PROXY": "False",
        "LOG_LEVEL": "INFO",
    }

    if not ENV_PATH.exists():
        ENV_PATH.write_text(
            "".join(f"{key}={value}\n" for key, value in required_vars.items()),
            encoding="utf-8",
        )
    else:
        existing = ENV_PATH.read_text(encoding="utf-8")
        missing = [
            (key, default)
            for key, default in required_vars.items()
            if not any(line.startswith(f"{key}=") for line in existing.splitlines())
        ]
        if missing:
            with ENV_PATH.open("a", encoding="utf-8") as env_file:
                for key, default in missing:
                    env_file.write(f"{key}={default}\n")

    load_dotenv(ENV_PATH, override=False)


ensure_env_file()

from flask import Flask, request, render_template, jsonify, send_from_directory
from flask_login import current_user, login_required
from flask_socketio import join_room
from flask_wtf.csrf import CSRFProtect, generate_csrf
from flask_babel import get_locale
from sqlalchemy import event, inspect as sa_inspect
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.exceptions import HTTPException

from config import Config
from extensions import db, login_manager, socketio, init_extensions
from models import User, DeviceType, Settings, Device
from blueprints.auth import auth_bp
from blueprints.admin import admin_bp
from blueprints.main import main_bp
from blueprints.api import api_bp
from blueprints.i18n import i18n_bp
from services.monitor import init_monitor, start_monitor, stop_monitor
from services.permissions import can_view_map
from services.js_i18n import js_i18n_payload
from services.db.schema_service import (
    mark_sqlite_schema,
    sqlite_database_is_empty,
    validate_sqlite_database,
    validate_database_schema,
)
from utils.logger import app_logger


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    # Отключаем кэширование шаблонов в debug режиме
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
    csrf = CSRFProtect(app)

    if os.environ.get("BEHIND_PROXY") == "True":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    init_extensions(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(i18n_bp)

    # CSRFProtect активен для всех endpoints.
    # GET-запросы не проверяются (безопасно, не меняют состояние).
    # POST/PUT/DELETE требуют X-CSRFToken заголовок.
    # Фронтенд уже добавляет его через http.js.

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

        # --- Контроль схемы БД ---
        # Для существующей БД запрещаем тихое создание недостающих таблиц:
        # это могло скрыть несовместимое восстановление/старую версию.
        # Чистая БД создаётся из текущих моделей.
        database_uri = app.config["SQLALCHEMY_DATABASE_URI"]
        sqlite_path = None
        if database_uri.startswith("sqlite:///"):
            sqlite_path = database_uri.replace("sqlite:///", "", 1)
            if not os.path.isabs(sqlite_path):
                sqlite_path = os.path.join(app.root_path, sqlite_path)

            if sqlite_database_is_empty(sqlite_path):
                db.create_all()
            else:
                schema_result = validate_sqlite_database(
                    sqlite_path, db.metadata, expected_version=Config.VERSION
                )
                if not schema_result.valid:
                    app_logger.critical(
                        "Database schema is incompatible with this LinkVision version: %s",
                        schema_result.message,
                    )
                    raise RuntimeError(
                        "Несовместимая схема базы данных. "
                        f"{schema_result.message}. "
                        "Запустите поддерживаемую миграцию или восстановите совместимую резервную копию."
                    )
        else:
            # PostgreSQL: create_all() допустим только для действительно новой
            # базы. Для существующей схемы он НЕ является миграцией: проверяем
            # структуру и останавливаем запуск при несовместимости.
            inspector = sa_inspect(db.engine)
            if not inspector.get_table_names():
                db.create_all()
            else:
                schema_result = validate_database_schema(db.engine, db.metadata)
                if not schema_result.valid:
                    app_logger.critical(
                        "Database schema is incompatible with this LinkVision version: %s",
                        schema_result.message,
                    )
                    raise RuntimeError(
                        "Несовместимая схема PostgreSQL. "
                        f"{schema_result.message}. "
                        "Автоматическое изменение существующей PostgreSQL-схемы отключено; "
                        "примените поддерживаемую миграцию перед запуском приложения."
                    )

        # После успешной проверки/создания фиксируем версию схемы SQLite.
        if database_uri.startswith("sqlite:///") and sqlite_path:
            mark_sqlite_schema(sqlite_path, Config.VERSION)

        # --- Создание администратора, если ни одного нет ---
        if not User.query.filter_by(is_admin=True).first():
            admin = User(username="admin", is_admin=True)
            default_password = secrets.token_urlsafe(16)
            admin.set_password(default_password)
            admin.must_change_password = True
            db.session.add(admin)
            db.session.commit()

            # В лог — без пароля
            app_logger.warning(
                "Создан администратор admin. Пароль выведен в консоль при первом запуске."
            )
            # В консоль — печатаем напрямую, не через ротируемый файловый логгер
            print(
                f"\n{'='*60}\n  Temporary admin password: {default_password}\n{'='*60}\n"
            )

        # --- Настройки мониторинга, если ещё не заданы ---
        if not db.session.get(Settings, "ping_count"):
            db.session.add(Settings(key="ping_count", value="4"))
        if not db.session.get(Settings, "ping_interval"):
            db.session.add(Settings(key="ping_interval", value="10"))
        if not db.session.get(Settings, "ping_timeout"):
            db.session.add(Settings(key="ping_timeout", value="1.0"))
        if not db.session.get(Settings, "history_retention_days"):
            db.session.add(Settings(key="history_retention_days", value="7"))
        if not db.session.get(Settings, "monitor_max_workers"):
            db.session.add(Settings(key="monitor_max_workers", value="150"))

        # --- Дефолтные типы устройств, если таблица пуста ---
        if not DeviceType.query.first():
            default_types = ["Router", "Switch", "Server", "PC"]
            for name in default_types:
                db.session.add(DeviceType(name=name, icon_filename=""))
            app_logger.info("Добавлены стандартные типы устройств")

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
        app_logger.info(f"Клиент присоединился к комнате {room}")

    @socketio.on("connect")
    def handle_connect():
        app_logger.info(f"Клиент подключился: {request.sid}")  # type: ignore

    @socketio.on("disconnect")
    def handle_disconnect():
        app_logger.info(f"Клиент отключился: {request.sid}")  # type: ignore

    start_monitor()
    atexit.register(stop_monitor)

    @app.route("/static/uploads/maps/<path:filename>")
    @login_required
    def serve_map_background(filename):
        maps_dir = os.path.join(app.root_path, "static", "uploads", "maps")
        return send_from_directory(maps_dir, filename)

    @app.route("/static/uploads/icons/<path:filename>")
    @login_required
    def serve_icon(filename):
        icons_dir = os.path.join(app.root_path, "static", "uploads", "icons")
        return send_from_directory(icons_dir, filename)

    @app.context_processor
    def inject_globals():
        locale = str(get_locale() or Config.BABEL_DEFAULT_LOCALE)
        return {
            "app_version": Config.VERSION,
            "debug_mode": app.debug,
            "csrf_token": lambda: generate_csrf(),
            "current_locale": locale,
            "available_languages": Config.LANGUAGES,
            # Словарь для фронтенда — синхронная инъекция в window.__I18N__ (Фаза 2)
            "js_i18n": js_i18n_payload(locale),
        }

    @app.errorhandler(404)
    def page_not_found(e):
        return render_template("404.html", hide_sidebar=True), 404

    # ─── Security headers ───────────────────────────────────────────────────
    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
        )
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
            "img-src 'self' data: blob:; "
            "font-src 'self' https://cdnjs.cloudflare.com; "
            "connect-src 'self' ws: wss:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'self';"
        )
        if app.config.get("SESSION_COOKIE_SECURE"):
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains"
            )
        return response

    @app.errorhandler(Exception)
    def handle_unexpected(e):
        if isinstance(e, HTTPException):
            return e
        app_logger.exception("Unhandled exception")
        return jsonify({"error": "Внутренняя ошибка сервера"}), 500

    @socketio.on("request_status")
    def handle_request_status(data):
        map_id = data.get("map_id")
        if not map_id or not current_user.is_authenticated or not can_view_map(map_id):
            return

        with app.app_context():
            devices = Device.query.filter_by(map_id=map_id).all()
            # Поля качества тоже нужны, а не только status — иначе этот
            # (лёгкий) путь ресинхронизации после реконнекта оставляет
            # quality_status/latency/jitter/loss на карте устаревшими, пока
            # их не подтянет следующий цикл монитора или полный reload.
            statuses = [
                {
                    "id": d.id,
                    "status": d.status if d.monitoring_enabled else "up",
                    "monitoring_enabled": d.monitoring_enabled,
                    "quality_status": d.quality_status if d.monitoring_enabled else "unknown",
                    "quality_latency_ms": d.quality_latency_ms if d.monitoring_enabled else None,
                    "quality_jitter_ms": d.quality_jitter_ms if d.monitoring_enabled else None,
                    "quality_loss_percent": d.quality_loss_percent if d.monitoring_enabled else None,
                }
                for d in devices
            ]
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
