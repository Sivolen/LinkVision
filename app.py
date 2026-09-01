import atexit
import secrets
from pathlib import Path

from flask import Flask, request, render_template, jsonify
from flask_login import current_user, login_required
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
from blueprints.i18n import i18n_bp
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


def _ensure_user_locale_column():
    """Идемпотентно добавляет колонку user.locale, если её ещё нет.

    Нужно, потому что db.create_all() в проекте отключён и папки migrations/ нет:
    у существующих БД (SQLite/PostgreSQL) новой колонки не будет, а модель её уже
    объявляет — без ALTER первый же SELECT по User упал бы. Вызывается один раз
    при старте, внутри app_context.
    """
    from sqlalchemy import inspect as sa_inspect, text
    from sqlalchemy.exc import NoSuchTableError

    inspector = sa_inspect(db.engine)
    try:
        columns = {col["name"] for col in inspector.get_columns("user")}
    except NoSuchTableError:
        # Таблицы ещё нет (напр. чистая БД) — мигрировать нечего; когда таблица
        # создастся из модели, колонка locale уже будет в ней.
        return
    if "locale" in columns:
        return
    db.session.execute(text('ALTER TABLE "user" ADD COLUMN locale VARCHAR(8)'))
    db.session.commit()
    app_logger.info("Добавлена колонка user.locale (i18n)")


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

    migrate = Migrate(app, db)

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

        # --- i18n: гарантируем колонку user.locale ---
        # db.create_all() в проекте отключён, миграций (migrations/) нет, поэтому
        # для существующих БД добавляем новую nullable-колонку разово и идемпотентно.
        # ALTER TABLE ... ADD COLUMN работает и в SQLite, и в PostgreSQL; "user"
        # закавычен, т.к. в PostgreSQL это зарезервированное слово. Должно идти ДО
        # первого запроса к User (иначе SELECT по несуществующей колонке упадёт).
        _ensure_user_locale_column()

        # --- Создание таблиц, если их нет ---
        db.create_all()
        
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
        from flask import send_from_directory

        maps_dir = os.path.join(app.root_path, "static", "uploads", "maps")
        return send_from_directory(maps_dir, filename)

    @app.route("/static/uploads/icons/<path:filename>")
    @login_required
    def serve_icon(filename):
        from flask import send_from_directory

        icons_dir = os.path.join(app.root_path, "static", "uploads", "icons")
        return send_from_directory(icons_dir, filename)

    @app.context_processor
    def inject_globals():
        from config import Config
        from flask_wtf.csrf import generate_csrf
        from flask_babel import get_locale  # выбранная локаль (не селектор!)
        from services.js_i18n import js_i18n_payload

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
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
            "img-src 'self' data: blob:; "
            "font-src 'self' https://cdnjs.cloudflare.com; "
            "connect-src 'self' ws: wss:; "
            "frame-ancestors 'self';"
        )
        if app.config.get("SESSION_COOKIE_SECURE"):
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains"
            )
        return response

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
