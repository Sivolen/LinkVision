from flask import Blueprint, render_template, redirect, url_for, request, jsonify, current_app, flash, abort
from flask_login import login_required, current_user
from extensions import db
from services import map_service
from utils.logger import main_logger

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
@login_required
def dashboard():
    available_maps = map_service.get_available_maps(current_user)

    # Если есть last_map_id и карта существует и доступна, идём на неё
    if current_user.last_map_id:
        last_map = map_service.get_map_by_id(current_user.last_map_id)
        if last_map and (current_user.is_admin or current_user.is_operator or last_map.owner_id == current_user.id):
            return redirect(url_for('main.map_view', map_id=last_map.id))

    # Иначе на первую доступную карту
    if available_maps:
        return redirect(url_for('main.map_view', map_id=available_maps[0].id))

    # Карт нет
    if current_user.is_operator:
        return render_template('no_maps.html')
    else:
        return redirect(url_for('main.create_map_page'))


@main_bp.route('/map/create-page')
@login_required
def create_map_page():
    return render_template('map_view.html', map=None)


@main_bp.route('/map/create', methods=['POST'])
@login_required
def create_map():
    if current_user.is_operator:
        flash('Оператор не может создавать карты')
        return redirect(url_for('main.dashboard'))

    name = request.form.get('name')
    if name:
        new_map = map_service.create_new_map(name, current_user.id)
        main_logger.info(f"Map created: {name}, ID={new_map.id}, owner={current_user.username}")
        return redirect(url_for('main.map_view', map_id=new_map.id))
    return redirect(url_for('main.dashboard'))


@main_bp.route('/map/<int:map_id>')
@login_required
def map_view(map_id):
    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        abort(404)

    if not (current_user.is_admin or map_obj.owner_id == current_user.id or current_user.is_operator):
        abort(403)

    # Сохраняем последнюю карту пользователя
    if current_user.last_map_id != map_id:
        current_user.last_map_id = map_id
        db.session.commit()

    # Получаем или создаём настройки для этого пользователя и карты
    settings = map_service.get_user_settings(current_user.id, map_id)
    main_logger.info(f"Rendering map {map_id} for user {current_user.id}: pan=({settings.pan_x}, {settings.pan_y}), zoom={settings.zoom}")

    return render_template('map_view.html',
                          map=map_obj,
                          is_operator=current_user.is_operator,
                          user_pan_x=settings.pan_x,
                          user_pan_y=settings.pan_y,
                          user_zoom=settings.zoom)


@main_bp.route('/api/sidebar-maps')
@login_required
def get_sidebar_maps():
    data = map_service.get_sidebar_maps_data(current_user)
    return jsonify(data)


@main_bp.route('/api/map/<int:map_id>', methods=['DELETE'])
@login_required
def delete_map(map_id):
    if current_user.is_operator:
        return jsonify({'error': 'Оператор не может удалять карты'}), 403

    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({'error': 'Map not found'}), 404

    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    try:
        map_service.delete_map_and_cleanup(map_id, current_app)
        return jsonify({'status': 'deleted'})
    except Exception as e:
        main_logger.error(f"Error deleting map {map_id}: {e}")
        return jsonify({'error': str(e)}), 500
