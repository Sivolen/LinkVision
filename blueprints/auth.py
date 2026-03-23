from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, login_required, current_user

from forms import LoginForm, RegisterForm
from services import user_service
from utils.logger import auth_logger

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('main.dashboard'))
    form = LoginForm()
    if form.validate_on_submit():
        username = form.username.data
        password = form.password.data
        user = user_service.authenticate_user(username, password)
        if user:
            login_user(user)
            next_page = request.args.get('next')
            return redirect(next_page) if next_page else redirect(url_for('main.dashboard'))
        flash('Неверный логин или пароль')
    return render_template('login.html', form=form)


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
    form = RegisterForm()
    if form.validate_on_submit():
        username = form.username.data
        password = form.password.data
        if user_service.get_user_by_username(username):
            flash('Пользователь уже существует')
            return redirect(url_for('auth.register'))
        try:
            user_service.create_user(username, password, role='user')
            flash('Регистрация успешна. Войдите.')
            return redirect(url_for('auth.login'))
        except Exception as e:
            flash('Ошибка при регистрации')
    return render_template('register.html', form=form)
