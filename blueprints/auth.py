from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, login_required, current_user
from services import user_service
from utils.logger import auth_logger

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.dashboard'))

    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = user_service.authenticate_user(username, password)
        if user:
            login_user(user)
            next_page = request.args.get('next')
            return redirect(next_page) if next_page else redirect(url_for('main.dashboard'))
        flash('Неверный логин или пароль')
    return render_template('login.html')


@auth_bp.route('/logout')
@login_required
def logout():
    auth_logger.info(f"User logged out: {current_user.username}")
    logout_user()
    return redirect(url_for('auth.login'))


@auth_bp.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('main.dashboard'))

    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if not username or not password:
            flash('Имя пользователя и пароль обязательны')
            return redirect(url_for('auth.register'))

        if user_service.get_user_by_username(username):
            auth_logger.warning(f"Registration attempt with existing username: {username}")
            flash('Пользователь уже существует')
            return redirect(url_for('auth.register'))

        try:
            user_service.create_user(username, password, role='user')  # по умолчанию обычный пользователь
            flash('Регистрация успешна. Войдите.')
            return redirect(url_for('auth.login'))
        except Exception as e:
            auth_logger.error(f"Error registering user: {e}")
            flash('Ошибка при регистрации')

    return render_template('register.html')
