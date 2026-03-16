import os
from flask import Blueprint, render_template, redirect, url_for, request, jsonify, current_app, flash, abort
from flask_login import login_required, current_user
from extensions import db
from models import Map, Device, User
from utils.logger import main_logger

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
@login_required
def dashboard():
    # Список карт, доступных пользователю
    if current_user.is_admin or current_user.is_operator:
        available_maps = Map.query.all()
    else:
        available_maps = Map.query.filter_by(owner_id=current_user.id).all()

    # Если есть last_map_id и карта существует и доступна, идём на неё
    if current_user.last_map_id:
        last_map = Map.query.get(current_user.last_map_id)
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
        new_map = Map(name=name, owner_id=current_user.id)
        db.session.add(new_map)
        db.session.commit()
        main_logger.info(f"Map created: {name}, ID={new_map.id}, owner={current_user.username}")
        return redirect(url_for('main.map_view', map_id=new_map.id))
    return redirect(url_for('main.dashboard'))


@main_bp.route('/map/<int:map_id>')
@login_required
def map_view(map_id):
    map_obj = Map.query.get_or_404(map_id)
    if not (current_user.is_admin or map_obj.owner_id == current_user.id or current_user.is_operator):
        abort(403)

    # Сохраняем последнюю карту пользователя
    if current_user.last_map_id != map_id:
        current_user.last_map_id = map_id
        db.session.commit()

    return render_template('map_view.html', map=map_obj, is_operator=current_user.is_operator)


@main_bp.route('/api/sidebar-maps')
@login_required
def get_sidebar_maps():
    if current_user.is_admin or current_user.is_operator:
        maps = Map.query.all()
    else:
        maps = Map.query.filter_by(owner_id=current_user.id).all()

    result = []
    for m in maps:
        down_count = Device.query.filter_by(map_id=m.id, status=False).count()
        result.append({
            'id': m.id,
            'name': m.name,
            'owner_id': m.owner_id,
            'down_count': down_count
        })
    return jsonify(result)


@main_bp.route('/api/map/<int:map_id>', methods=['DELETE'])
@login_required
def delete_map(map_id):
    if current_user.is_operator:
        return jsonify({'error': 'Оператор не может удалять карты'}), 403
    map_obj = Map.query.get_or_404(map_id)
    if not (current_user.is_admin or map_obj.owner_id == current_user.id):
        return jsonify({'error': 'Доступ запрещён'}), 403

    # Сбрасываем last_map_id у всех пользователей, у которых эта карта была последней
    User.query.filter_by(last_map_id=map_id).update({'last_map_id': None})

    # Удаление файла фона (если есть)
    if map_obj.background_image:
        bg_path = os.path.join(current_app.config['UPLOAD_FOLDER'], 'maps', map_obj.background_image)
        if os.path.exists(bg_path):
            os.remove(bg_path)

    db.session.delete(map_obj)
    db.session.commit()
    return jsonify({'status': 'deleted'})