"""
Переключение языка интерфейса.

Роут через POST (а не GET-ссылку) намеренно: действие меняет состояние
(пишет в сессию и, для авторизованных, в БД), поэтому должно проходить CSRF —
как и остальной проект. Простая ссылка <a href="/set-language/en"> была бы
CSRF-уязвимой точкой.
"""

from urllib.parse import urlsplit

from flask import Blueprint, redirect, request, session, url_for
from flask_login import current_user

from config import Config
from extensions import db

i18n_bp = Blueprint("i18n", __name__)


def _is_safe_redirect_url(target: str) -> bool:
    """Редирект только на локальный путь (тот же принцип, что в blueprints/auth.py)."""
    if not target:
        return False
    parsed = urlsplit(target)
    return not parsed.netloc and not parsed.scheme and target.startswith("/")


@i18n_bp.route("/set-language/<lang_code>", methods=["POST"])
def set_language(lang_code):
    if lang_code not in Config.LANGUAGES:
        lang_code = Config.BABEL_DEFAULT_LOCALE

    session["locale"] = lang_code

    # Авторизованный пользователь — сохраняем выбор в БД (привычка между сессиями)
    if current_user.is_authenticated:
        current_user.locale = lang_code
        db.session.commit()

    next_page = request.form.get("next") or request.referrer
    if next_page and _is_safe_redirect_url(next_page):
        return redirect(next_page)
    return redirect(url_for("main.dashboard"))
