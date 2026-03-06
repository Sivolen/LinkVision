from flask import Blueprint, render_template, redirect, url_for, request
from flask_login import login_required, current_user
from extensions import db
from models import Map

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
@login_required
def dashboard():
    if current_user.is_admin:
        maps = Map.query.all()
    else:
        maps = Map.query.filter_by(owner_id=current_user.id).all()
    return render_template('dashboard.html', maps=maps)

@main_bp.route('/map/create', methods=['POST'])
@login_required
def create_map():
    name = request.form.get('name')
    if name:
        new_map = Map(name=name, owner_id=current_user.id)
        db.session.add(new_map)
        db.session.commit()
    return redirect(url_for('main.dashboard'))

@main_bp.route('/map/<int:map_id>')
@login_required
def map_view(map_id):
    map_obj = Map.query.get_or_404(map_id)
    if not current_user.is_admin and map_obj.owner_id != current_user.id:
        return "Доступ запрещен", 403
    return render_template('map_view.html', map=map_obj)