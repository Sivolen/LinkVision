import os
import shutil
from datetime import datetime
from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, abort, send_file
from flask_login import login_required, current_user
from extensions import db
from models import Map
from services import user_service, device_type_service, settings_service
from utils.logger import admin_logger

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')


@admin_bp.before_request
def check_admin():
    if not current_user.is_authenticated or not current_user.is_admin:
        flash('Доступ запрещен. Требуются права администратора.')
        return redirect(url_for('main.dashboard'))
    return None  # явное возвращение None для продолжения запроса


# ============================================================================
# Управление пользователями
# ============================================================================

@admin_bp.route('/users')
def users():
    all_users = user_service.get_all_users()
    return render_template('admin/users.html', users=all_users)


@admin_bp.route('/users/create', methods=['POST'])
def create_user():
    username = request.form.get('username')
    password = request.form.get('password')
    role = request.form.get('role')  # 'user', 'operator', 'admin'

    if not username or not password:
        flash('Имя пользователя и пароль обязательны')
        return redirect(url_for('admin.users'))

    if user_service.get_user_by_username(username):
        flash('Пользователь с таким именем уже существует')
        return redirect(url_for('admin.users'))

    try:
        user_service.create_user(username, password, role)
        flash('Пользователь создан')
    except Exception as e:
        admin_logger.error(f"Error creating user: {e}")
        flash('Ошибка при создании пользователя')
    return redirect(url_for('admin.users'))


@admin_bp.route('/users/delete/<int:id>')
def delete_user(id):
    user = user_service.get_user_by_id(id)
    if not user:
        flash('Пользователь не найден')
        return redirect(url_for('admin.users'))

    if user.id == current_user.id:
        flash('Нельзя удалить самого себя')
        return redirect(url_for('admin.users'))

    try:
        user_service.delete_user(id)
        flash('Пользователь удалён')
    except Exception as e:
        admin_logger.error(f"Error deleting user: {e}")
        flash('Ошибка при удалении пользователя')
    return redirect(url_for('admin.users'))


@admin_bp.route('/users/edit/<int:id>', methods=['GET', 'POST'])
def edit_user(id):
    user = user_service.get_user_by_id(id)
    if not user:
        abort(404)

    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        role = request.form.get('role')

        if not username:
            flash('Имя пользователя обязательно')
            return redirect(url_for('admin.edit_user', id=id))

        # Проверка уникальности имени
        existing = user_service.get_user_by_username(username)
        if existing and existing.id != id:
            flash('Пользователь с таким именем уже существует')
            return redirect(url_for('admin.edit_user', id=id))

        try:
            user_service.update_user(id, username=username, password=password, role=role)
            flash('Пользователь обновлён')
            return redirect(url_for('admin.users'))
        except Exception as e:
            admin_logger.error(f"Error updating user: {e}")
            flash('Ошибка при обновлении пользователя')

    # GET: показываем форму редактирования
    return render_template('admin/users.html', edit_user=user, users=user_service.get_all_users())


# ============================================================================
# Управление типами устройств
# ============================================================================

@admin_bp.route('/types')
def types():
    all_types = device_type_service.get_all_device_types()
    return render_template('admin/types.html', types=all_types)


@admin_bp.route('/types/create', methods=['POST'])
def create_type():
    name = request.form.get('name')
    width = request.form.get('width')
    height = request.form.get('height')
    icon = request.files.get('icon')

    if not name:
        flash('Название типа обязательно')
        return redirect(url_for('admin.types'))

    try:
        device_type_service.create_device_type(name, width, height, icon)
        flash('Тип устройства создан')
    except Exception as e:
        admin_logger.error(f"Error creating device type: {e}")
        flash('Ошибка при создании типа')
    return redirect(url_for('admin.types'))


@admin_bp.route('/types/<int:id>/edit', methods=['GET', 'POST'])
def edit_type(id):
    dtype = device_type_service.get_device_type_by_id(id)
    if not dtype:
        abort(404)

    if request.method == 'POST':
        name = request.form.get('name')
        width = request.form.get('width')
        height = request.form.get('height')
        icon = request.files.get('icon')

        try:
            device_type_service.update_device_type(id, name, width, height, icon)
            flash('Тип устройства обновлён')
            return redirect(url_for('admin.types'))
        except Exception as e:
            admin_logger.error(f"Error updating device type: {e}")
            flash('Ошибка при обновлении типа')

    all_types = device_type_service.get_all_device_types()
    return render_template('admin/types.html', types=all_types, edit_type=dtype)


@admin_bp.route('/types/<int:id>/delete')
def delete_type(id):
    try:
        device_type_service.delete_device_type(id)
        flash('Тип устройства удалён')
    except Exception as e:
        admin_logger.error(f"Error deleting device type: {e}")
        flash('Ошибка при удалении типа')
    return redirect(url_for('admin.types'))


# ============================================================================
# Настройки
# ============================================================================

@admin_bp.route('/settings', methods=['GET', 'POST'])
def settings():
    # Информация о БД
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
            try:
                settings_service.update_ping_settings(ping_count, ping_interval)
                flash('Настройки сохранены')
            except Exception as e:
                admin_logger.error(f"Error updating settings: {e}")
                flash('Ошибка при сохранении настроек')
            return redirect(url_for('admin.settings'))
        elif 'restore_backup' in request.form:
            return restore_backup_action()

    ping_count, ping_interval = settings_service.get_ping_settings()
    return render_template('admin/settings.html',
                           count=ping_count,
                           interval=ping_interval,
                           db_size=db_size,
                           db_mtime=db_mtime)


# ============================================================================
# Управление картами
# ============================================================================

@admin_bp.route('/maps')
def maps_list():
    all_maps = Map.query.all()  # Пока оставим прямое обращение, можно вынести позже
    return render_template('admin/maps.html', maps=all_maps)


@admin_bp.route('/maps/delete/<int:id>')
def delete_map(id):
    map_obj = Map.query.get_or_404(id)
    try:
        # Здесь можно использовать map_service.delete_map, но пока оставим как есть
        db.session.delete(map_obj)
        db.session.commit()
        admin_logger.info(f"Map deleted: ID={id}")
        flash('Карта удалена')
    except Exception as e:
        admin_logger.error(f"Error deleting map: {e}")
        flash('Ошибка при удалении карты')
    return redirect(url_for('admin.maps_list'))


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

    try:
        file.save(db_path)
        admin_logger.info("Database restored from uploaded file")
        flash('База данных восстановлена. Пожалуйста, перезапустите приложение для применения изменений.')
    except Exception as e:
        admin_logger.error(f"Error restoring database: {e}")
        flash('Ошибка при восстановлении базы данных')
    return redirect(url_for('admin.settings'))


@admin_bp.route('/backups/download')
@login_required
def download_backup():
    db_path = current_app.config['SQLALCHEMY_DATABASE_URI'].replace('sqlite:///', '')
    if not db_path.startswith('/'):
        db_path = os.path.join(current_app.root_path, db_path)

    if not os.path.exists(db_path):
        abort(404)

    admin_logger.info("Backup downloaded")
    return send_file(db_path, as_attachment=True, download_name='webnetmap_backup.db')
