import os
from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from extensions import db
from models import User, DeviceType, Settings, Map

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')


@admin_bp.before_request
def check_admin():
    if not current_user.is_authenticated or not current_user.is_admin:
        flash('Доступ запрещен. Требуются права администратора.')
        return redirect(url_for('main.dashboard'))


@admin_bp.route('/users')
def users():
    all_users = User.query.all()
    return render_template('admin/users.html', users=all_users)


@admin_bp.route('/users/create', methods=['POST'])
def create_user():
    username = request.form.get('username')
    password = request.form.get('password')
    is_admin = request.form.get('is_admin') == 'on'
    user = User(username=username, is_admin=is_admin)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return redirect(url_for('admin.users'))


@admin_bp.route('/users/delete/<int:id>')
def delete_user(id):
    user = User.query.get_or_404(id)
    if user.id == current_user.id:
        flash('Нельзя удалить самого себя')
    else:
        db.session.delete(user)
        db.session.commit()
    return redirect(url_for('admin.users'))


@admin_bp.route('/types')
def types():
    types = DeviceType.query.all()
    return render_template('admin/types.html', types=types)


@admin_bp.route('/types/create', methods=['POST'])
def create_type():
    name = request.form.get('name')
    icon = request.files.get('icon')
    filename = None
    if icon and icon.filename:
        filename = secure_filename(icon.filename)
        icon.save(os.path.join(current_app.config['UPLOAD_FOLDER'], filename))

    dtype = DeviceType(name=name, icon_filename=filename)
    db.session.add(dtype)
    db.session.commit()
    return redirect(url_for('admin.types'))


@admin_bp.route('/settings', methods=['GET', 'POST'])
def settings():
    if request.method == 'POST':
        ping_count = request.form.get('ping_count')
        ping_interval = request.form.get('ping_interval')

        Settings.query.filter_by(key='ping_count').update({'value': ping_count})
        Settings.query.filter_by(key='ping_interval').update({'value': ping_interval})
        db.session.commit()
        flash('Настройки сохранены')

    count = Settings.query.filter_by(key='ping_count').first()
    interval = Settings.query.filter_by(key='ping_interval').first()
    return render_template('admin/settings.html',
                           count=count.value if count else 4,
                           interval=interval.value if interval else 10)


@admin_bp.route('/maps')
def maps_list():  # ⚠️ Важно: имя функции maps_list → endpoint будет admin.maps_list
    all_maps = Map.query.all()
    return render_template('admin/maps.html', maps=all_maps)


@admin_bp.route('/maps/delete/<int:id>')
def delete_map(id):
    map_obj = Map.query.get_or_404(id)
    db.session.delete(map_obj)
    db.session.commit()
    return redirect(url_for('admin.maps_list'))  # ⚠️ Исправлено: admin.maps_list


@admin_bp.route('/types/<int:id>/edit', methods=['GET', 'POST'])
def edit_type(id):
    dtype = DeviceType.query.get_or_404(id)
    if request.method == 'POST':
        name = request.form.get('name')
        if name:
            dtype.name = name

        icon = request.files.get('icon')
        if icon and icon.filename:
            if dtype.icon_filename:
                old_path = os.path.join(current_app.config['UPLOAD_FOLDER'], dtype.icon_filename)
                if os.path.exists(old_path):
                    os.remove(old_path)
            filename = secure_filename(icon.filename)
            icon.save(os.path.join(current_app.config['UPLOAD_FOLDER'], filename))
            dtype.icon_filename = filename

        db.session.commit()
        flash('Тип устройства обновлён')
        return redirect(url_for('admin.types'))

    # Передаём edit_type в шаблон
    all_types = DeviceType.query.all()
    return render_template('admin/types.html', types=all_types, edit_type=dtype)


@admin_bp.route('/types/<int:id>/delete')
def delete_type(id):
    dtype = DeviceType.query.get_or_404(id)
    # Удаляем файл иконки если есть
    if dtype.icon_filename:
        icon_path = os.path.join(current_app.config['UPLOAD_FOLDER'], dtype.icon_filename)
        if os.path.exists(icon_path):
            os.remove(icon_path)
    db.session.delete(dtype)
    db.session.commit()
    flash('Тип устройства удалён')
    return redirect(url_for('admin.types'))