from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_socketio import SocketIO
from flask_migrate import Migrate
from flask_babel import Babel

db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = "auth.login"
socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode="threading",
    ping_interval=30,
    ping_timeout=100,
    # max_http_buffer_size=1e8
    max_http_buffer_size=100_000_000,
)
migrate = Migrate()
babel = Babel()


def init_extensions(app):
    db.init_app(app)
    login_manager.init_app(app)
    socketio.init_app(app)
    migrate.init_app(app, db)
    # locale_selector — API Flask-Babel 3.x+/4.x (передаётся в init_app,
    # а не декоратором @babel.localeselector, как было в 2.x).
    babel.init_app(app, locale_selector=select_locale)


def _available_languages():
    """Коды поддерживаемых языков из конфига (в контексте запроса/приложения)."""
    from flask import current_app

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
    from flask import request, session, current_app
    from flask_login import current_user

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
