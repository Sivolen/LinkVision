import os
import shutil
from datetime import datetime
from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, abort, send_file
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename
from extensions import db
from models import User, DeviceType, Settings, Map
from utils.logger import admin_logger

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
    role = request.form.get('role')  # 'user', 'operator', 'admin'

    if not username or not password:
        flash('Имя пользователя и пароль обязательны')
        return redirect(url_for('admin.users'))

    if User.query.filter_by(username=username).first():
        flash('Пользователь с таким именем уже существует')
        return redirect(url_for('admin.users'))

    # Преобразуем роль в два булевых поля
    is_admin = (role == 'admin')
    is_operator = (role == 'operator')   # оператор, но не админ

    user = User(username=username, is_admin=is_admin, is_operator=is_operator)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    admin_logger.info(f"User created: {username}, role={role}")
    flash('Пользователь создан')
    return redirect(url_for('admin.users'))


@admin_bp.route('/users/delete/<int:id>')
def delete_user(id):
    user = User.query.get_or_404(id)
    if user.id == current_user.id:
        flash('Нельзя удалить самого себя')
    else:
        db.session.delete(user)
        db.session.commit()
        admin_logger.info(f"User deleted: ID={id}")
    return redirect(url_for('admin.users'))


@admin_bp.route('/types')
def types():
    types = DeviceType.query.all()
    return render_template('admin/types.html', types=types)


@admin_bp.route('/types/create', methods=['POST'])
def create_type():
    name = request.form.get('name')
    width = request.form.get('width')
    height = request.form.get('height')
    icon = request.files.get('icon')
    filename = None
    if icon and icon.filename:
        filename = secure_filename(icon.filename)
        icon.save(os.path.join(current_app.config['UPLOAD_FOLDER'], filename))

    dtype = DeviceType(
        name=name,
        icon_filename=filename,
        width=int(width) if width else None,
        height=int(height) if height else None
    )
    db.session.add(dtype)
    db.session.commit()
    admin_logger.info(f"Device type created: {name}")
    return redirect(url_for('admin.types'))


@admin_bp.route('/settings', methods=['GET', 'POST'])
def settings():
    db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
    if not db_path.startswith('/'):
        db_path = os.path.join(current_app.root_path, db_path)

    if os.path.exists(db_path):
        db_size = os.path.getsize(db_path)
        db_mtime = datetime.fromtimestamp(os.path.getmtime(db_path))
    else:
        db_size = 0
        db_mtime = None

    if request.method == 'POST':
        if 'ping_count' in request.form:
            ping_count = request.form.get('ping_count')
            ping_interval = request.form.get('ping_interval')
            Settings.query.filter_by(key='ping_count').update({'value': ping_count})
            Settings.query.filter_by(key='ping_interval').update({'value': ping_interval})
            db.session.commit()
            admin_logger.info(f"Settings updated: ping_count={ping_count}, ping_interval={ping_interval}")
            flash('Настройки сохранены')
            return redirect(url_for('admin.settings'))
        elif 'restore_backup' in request.form:
            return restore_backup_action()

    count = Settings.query.filter_by(key='ping_count').first()
    interval = Settings.query.filter_by(key='ping_interval').first()

    return render_template('admin/settings.html',
                           count=count.value if count else 4,
                           interval=interval.value if interval else 10,
                           db_size=db_size,
                           db_mtime=db_mtime)


@admin_bp.route('/maps')
def maps_list():
    all_maps = Map.query.all()
    return render_template('admin/maps.html', maps=all_maps)


@admin_bp.route('/maps/delete/<int:id>')
def delete_map(id):
    map_obj = Map.query.get_or_404(id)
    db.session.delete(map_obj)
    db.session.commit()
    admin_logger.info(f"Map deleted: ID={id}")
    return redirect(url_for('admin.maps_list'))


@admin_bp.route('/types/<int:id>/edit', methods=['GET', 'POST'])
def edit_type(id):
    dtype = DeviceType.query.get_or_404(id)
    if request.method == 'POST':
        name = request.form.get('name')
        width = request.form.get('width')
        height = request.form.get('height')
        if name:
            dtype.name = name
        dtype.width = int(width) if width else None
        dtype.height = int(height) if height else None

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
        admin_logger.info(f"Device type updated: ID={id}")
        flash('Тип устройства обновлён')
        return redirect(url_for('admin.types'))

    all_types = DeviceType.query.all()
    return render_template('admin/types.html', types=all_types, edit_type=dtype)


@admin_bp.route('/types/<int:id>/delete')
def delete_type(id):
    dtype = DeviceType.query.get_or_404(id)
    if dtype.icon_filename:
        icon_path = os.path.join(current_app.config['UPLOAD_FOLDER'], dtype.icon_filename)
        if os.path.exists(icon_path):
            os.remove(icon_path)
    db.session.delete(dtype)
    db.session.commit()
    admin_logger.info(f"Device type deleted: ID={id}")
    flash('Тип устройства удалён')
    return redirect(url_for('admin.types'))


@admin_bp.route('/users/edit/<int:id>', methods=['GET', 'POST'])
def edit_user(id):
    user = User.query.get_or_404(id)
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        role = request.form.get('role')

        if not username:
            flash('Имя пользователя обязательно')
            return redirect(url_for('admin.edit_user', id=id))

        existing = User.query.filter_by(username=username).first()
        if existing and existing.id != id:
            flash('Пользователь с таким именем уже существует')
            return redirect(url_for('admin.edit_user', id=id))

        user.username = username
        if password:
            user.set_password(password)

        # Обновляем роли
        user.is_admin = (role == 'admin')
        user.is_operator = (role == 'operator')

        db.session.commit()
        admin_logger.info(f"User updated: ID={id}, role={role}")
        flash('Пользователь обновлён')
        return redirect(url_for('admin.users'))

    return render_template('admin/users.html', edit_user=user, users=User.query.all())


# ============================================================================
# Вспомогательная функция для восстановления БД
# ============================================================================
def restore_backup_action():
    if 'backup_file' not in request.files:
        flash('Файл не выбран')
        return redirect(url_for('admin.settings'))

    file = request.files['backup_file']
    if file.filename == '':
        flash('Пустой файл')
        return redirect(url_for('admin.settings'))

    if not file.filename.endswith('.db'):
        flash('Допустимы только файлы .db')
        return redirect(url_for('admin.settings'))

    db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
    if not db_path.startswith('/'):
        db_path = os.path.join(current_app.root_path, db_path)

    backup_path = db_path + '.bak'
    if os.path.exists(db_path):
        shutil.copy2(db_path, backup_path)

    file.save(db_path)
    admin_logger.info("Database restored from uploaded file")
    flash('База данных восстановлена. Пожалуйста, перезапустите приложение для применения изменений.')
    return redirect(url_for('admin.settings'))


@admin_bp.route('/backups/download')
@login_required
def download_backup():
    db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
    if not db_path.startswith('/'):
        db_path = os.path.join(current_app.root_path, db_path)

    if not os.path.exists(db_path):
        abort(404)

    admin_logger.info(f"Backup downloaded")
    return send_file(db_path, as_attachment=True, download_name='webnetmap_backup.db')