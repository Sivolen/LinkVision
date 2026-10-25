import os

from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, current_user
from flask_socketio import SocketIO
from flask_babel import Babel
from flask import request, session, current_app

from config import Config

db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = "auth.login"
def _socketio_cors_origins():
    """
    Разрешённые Origin для WebSocket/polling.

    Авторизация идёт по cookie, поэтому "*" открывает путь для cross-site
    WebSocket hijacking. По умолчанию (None) python-engineio пропускает только
    тот же origin, что и страница (с учётом ProxyFix). Переопределение:
    SOCKETIO_CORS_ORIGINS="https://a.example,https://b.example" или "*".
    """
    raw = os.environ.get("SOCKETIO_CORS_ORIGINS", "").strip()
    if not raw:
        return None
    if raw == "*":
        return "*"
    return [item.strip() for item in raw.split(",") if item.strip()]


socketio = SocketIO(
    cors_allowed_origins=_socketio_cors_origins(),
    # async_mode не указан — Flask-SocketIO определит eventlet сам,
    # т.к. пакет установлен и процесс при запуске (gunicorn -k eventlet)
    # монки-патчит глобальные I/O-функции под кооперативную модель.
    # Явное "threading" ломало эту магию: heartbeat, фоновые задачи
    # и отслеживание разрывов шли через чужой шедулер, что приводило
    # к "иногда события не долетают" — ровно тому, что чинил fixalarm.
    # Было 30/100: «тихо» упавший сервер/сеть обнаруживались до ~130 с.
    # Теперь максимум ~55 с; клиенты после реконнекта сами пересинхронизируются.
    ping_interval=Config.SOCKETIO_PING_INTERVAL,
    ping_timeout=Config.SOCKETIO_PING_TIMEOUT,
    max_http_buffer_size=100_000_000,
)
babel = Babel()


def init_extensions(app):
    db.init_app(app)
    login_manager.init_app(app)
    socketio.init_app(app)
    # locale_selector — API Flask-Babel 3.x+/4.x (передаётся в init_app,
    # а не декоратором @babel.localeselector, как было в 2.x).
    babel.init_app(app, locale_selector=select_locale)


def _available_languages():
    """Коды поддерживаемых языков из конфига (в контексте запроса/приложения)."""
    return current_app.config["LANGUAGES"].keys()


def select_locale():
    """
    Определяет язык интерфейса. Приоритет:
      1. ?lang=en в query string — временное переключение (ссылки/тестирование);
         попутно запоминаем выбор в сессии.
      2. session['locale'] — выбор пользователя через переключатель в UI.
      3. User.locale в БД — сохранённая привычка авторизованного пользователя.
      4. Accept-Language заголовок браузера.
      5. BABEL_DEFAULT_LOCALE ('ru') — если ничего не подошло.

    Namespace-примечание: это НЕ flask_babel.get_locale (та возвращает уже
    выбранную локаль). Здесь именно селектор, поэтому имя select_locale.
    """
    languages = list(_available_languages())

    requested = request.args.get("lang")
    if requested and requested in languages:
        session["locale"] = requested
        return requested

    if session.get("locale") in languages:
        return session["locale"]

    if (
        current_user.is_authenticated
        and getattr(current_user, "locale", None) in languages
    ):
        return current_user.locale

    return request.accept_languages.best_match(
        languages, default=current_app.config["BABEL_DEFAULT_LOCALE"]
    )
