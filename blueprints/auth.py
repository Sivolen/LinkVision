from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_babel import gettext as _
from flask_login import login_user, logout_user, login_required, current_user
from extensions import db
from urllib.parse import urlsplit

from forms import LoginForm, RegisterForm, ChangePasswordForm
from services import user_service, rate_limit, log_auth_action, validate_password_full
from services.security_service import rate_limiter
from utils.logger import auth_logger

auth_bp = Blueprint("auth", __name__, url_prefix="/auth")


def _is_safe_redirect_url(target: str) -> bool:
    """Разрешаем редирект только на локальный путь (без схемы и хоста)."""
    if not target:
        return False
    parsed = urlsplit(target)
    return not parsed.netloc and not parsed.scheme and target.startswith("/")


@auth_bp.route("/login", methods=["GET", "POST"])
@rate_limit(max_requests=5, window_seconds=300)  # 5 попыток за 5 минут
def login():
    if current_user.is_authenticated:
        return redirect(url_for("main.dashboard"))

    form = LoginForm()
    if form.validate_on_submit():
        username = form.username.data
        password = form.password.data

        # Попытка аутентификации
        user = user_service.authenticate_user(username, password)

        if user:
            login_user(user)
            log_auth_action("login", user.id, user.username)
            auth_logger.info(f"User logged in: {user.username}")

            # Если требуется смена пароля — перенаправляем на страницу смены
            if user.must_change_password:
                return redirect(url_for("auth.change_password"))

            next_page = request.args.get("next")
            if next_page and _is_safe_redirect_url(next_page):
                return redirect(next_page)
            return redirect(url_for("main.dashboard"))
        else:
            # Логирование неудачной попытки
            log_auth_action("login_failed", 0, username)
            flash(_("Неверный логин или пароль"))

    return render_template("login.html", form=form)


@auth_bp.route("/logout")
@login_required
def logout():
    log_auth_action("logout", current_user.id, current_user.username)
    auth_logger.info(f"User logged out: {current_user.username}")
    logout_user()
    return redirect(url_for("auth.login"))


@auth_bp.route("/change-password", methods=["GET", "POST"])
@login_required
def change_password():
    """Смена пароля при первом входе или по требованию."""
    from services import change_user_password

    form = ChangePasswordForm()
    if form.validate_on_submit():
        if not current_user.check_password(form.current_password.data):
            flash(_("Неверный текущий пароль"), "error")
            return redirect(url_for("auth.change_password"))

        is_valid, error = validate_password_full(form.new_password.data, current_user.username)
        if not is_valid:
            flash(_("Слабый пароль: %(error)s", error=error), "error")
            return redirect(url_for("auth.change_password"))

        # Используем сервис для смены пароля
        change_user_password(current_user.id, form.new_password.data)

        log_auth_action("password_changed", current_user.id, current_user.username)
        auth_logger.info(f"Пароль изменён: {current_user.username}")
        flash(_("Пароль успешно изменён. Теперь используйте новый пароль."), "success")
        return redirect(url_for("main.dashboard"))

    return render_template("auth/change_password.html", form=form)


@auth_bp.route("/register", methods=["GET", "POST"])
@rate_limit(max_requests=20, window_seconds=300)  # 20 регистраций за 5 минут
def register():
    if current_user.is_authenticated:
        return redirect(url_for("main.dashboard"))

    form = RegisterForm()
    if form.validate_on_submit():
        username = form.username.data
        password = form.password.data

        # Проверка существования
        if user_service.get_user_by_username(username):
            flash(_("Пользователь уже существует"))
            return redirect(url_for("auth.register"))

        # Валидация сложности пароля
        is_valid, error = validate_password_full(password, username)
        if not is_valid:
            flash(_("Слабый пароль: %(error)s", error=error))
            return redirect(url_for("auth.register"))

        try:
            user_service.create_user(username, password, role="user")
            flash(_("Регистрация успешна. Войдите."))
            return redirect(url_for("auth.login"))
        except Exception as e:
            auth_logger.error(f"Registration error: {e}")
            flash(_("Ошибка при регистрации"))

    return render_template("register.html", form=form)


@auth_bp.route("/admin/reset-rate-limit", methods=["POST"])
@login_required
def reset_rate_limit():
    """Сбросить все rate limit счётчики (только для админов)."""
    if not current_user.is_admin:
        flash(_("Доступ запрещён"), "error")
        return redirect(url_for("main.dashboard"))

    rate_limiter.reset_all()
    flash(_("Rate limit счётчики сброшены"), "success")
    return redirect(request.referrer or url_for("main.dashboard"))

