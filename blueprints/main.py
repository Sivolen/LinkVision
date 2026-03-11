import os

from flask import Blueprint, render_template, redirect, url_for, request, jsonify, current_app
from flask_login import login_required, current_user
from extensions import db
from models import Map

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
@login_required
def dashboard():
    # Перенаправляем на первую карту или создаём новую
    maps = Map.query.filter_by(owner_id=current_user.id).all() if not current_user.is_admin else Map.query.all()
    if maps:
        return redirect(url_for('main.map_view', map_id=maps[0].id))
    return redirect(url_for('main.create_map_page'))


@main_bp.route('/map/create-page')
@login_required
def create_map_page():
    return render_template('map_view.html', map=None)


@main_bp.route('/map/create', methods=['POST'])
@login_required
def create_map():
    name = request.form.get('name')
    if name:
        new_map = Map(name=name, owner_id=current_user.id)
        db.session.add(new_map)
        db.session.commit()
        return redirect(url_for('main.map_view', map_id=new_map.id))
    return redirect(url_for('main.dashboard'))


@main_bp.route('/map/<int:map_id>')
@login_required
def map_view(map_id):
    map_obj = Map.query.get_or_404(map_id)
    if not current_user.is_admin and map_obj.owner_id != current_user.id:
        return "Доступ запрещен", 403
    return render_template('map_view.html', map=map_obj)


@main_bp.route('/api/sidebar-maps')
@login_required
def get_sidebar_maps():
    """API для загрузки карт в сайдбар"""
    if current_user.is_admin:
        maps = Map.query.all()
    else:
        maps = Map.query.filter_by(owner_id=current_user.id).all()

    return jsonify([{
        'id': m.id,
        'name': m.name,
        'owner_id': m.owner_id
    } for m in maps])


@main_bp.route('/api/map/<int:map_id>', methods=['DELETE'])
@login_required
def delete_map(map_id):
    map_obj = Map.query.get_or_404(map_id)
    if not current_user.is_admin and map_obj.owner_id != current_user.id:
        return jsonify({'error': 'Доступ запрещён'}), 403

    # Удаляем файл фона
    if map_obj.background_image:
        bg_path = os.path.join(current_app.config['UPLOAD_FOLDER'], 'maps', map_obj.background_image)
        if os.path.exists(bg_path):
            os.remove(bg_path)

    db.session.delete(map_obj)
    db.session.commit()
    return jsonify({'status': 'deleted'})
