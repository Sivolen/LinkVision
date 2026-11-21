import math

from flask import (
    Blueprint,
    render_template,
    redirect,
    url_for,
    request,
    jsonify,
    current_app,
    flash,
    abort,
)
from flask_babel import gettext as _
from flask_login import login_required, current_user
from extensions import db
from models import User, Map, Device, MapShape
from services import map_service, update_last_map_id
from services.permissions import (
    can_view_map,
    can_edit_map,
    can_delete_map,
    can_toggle_map_lock,
)
from utils.logger import main_logger

main_bp = Blueprint("main", __name__)


@main_bp.route("/api/app-version")
@login_required
def app_version():
    response = jsonify(
        version=current_app.config["VERSION"],
        build=current_app.config.get("BUILD_ID", ""),
    )
    response.headers["Cache-Control"] = (
        "no-store, no-cache, must-revalidate, max-age=0"
    )
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@main_bp.route("/health")
def health_check():
    """
    Health check endpoint для мониторинга.

    Returns:
        JSON статус приложения и БД
    """
    try:
        # Проверка подключения к БД
        db.session.execute(db.text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {str(e)}"

    # Статистика
    try:
        user_count = User.query.count()
        map_count = Map.query.count()
        device_count = Device.query.count()
    except Exception:
        user_count = map_count = device_count = 0

    return jsonify(
        {
            "status": "healthy" if db_status == "ok" else "unhealthy",
            "database": db_status,
            "stats": {
                "users": user_count,
                "maps": map_count,
                "devices": device_count,
            },
        }
    ), (200 if db_status == "ok" else 503)


@main_bp.route("/")
@login_required
def dashboard():
    available_maps = map_service.get_available_maps(current_user)

    # Если есть last_map_id и карта существует и доступна, идём на неё
    if current_user.last_map_id:
        last_map = map_service.get_map_by_id(current_user.last_map_id)
        if last_map and can_view_map(current_user.last_map_id):
            return redirect(url_for("main.map_view", map_id=last_map.id))

    # Иначе на первую доступную карту
    if available_maps:
        return redirect(url_for("main.map_view", map_id=available_maps[0].id))

    # Карт нет. Только администратор должен попадать в раздел управления
    # картами. Обычный пользователь/оператор остаётся на информационной
    # странице, иначе /admin/maps отправит его обратно на / и получится
    # бесконечный цикл редиректов.
    if current_user.is_admin:
        return redirect(url_for("admin.maps_list"))

    return render_template("no_maps.html")


# @main_bp.route('/map/create-page')
# @login_required
# def create_map_page():
#     if not current_user.is_admin:
#         abort(403)
#     return render_template('map_view.html', map=None)


@main_bp.route("/map/create", methods=["POST"])
@login_required
def create_map():
    if current_user.is_operator:
        flash(_("Оператор не может создавать карты"))
        return redirect(url_for("main.dashboard"))

    name = request.form.get("name")
    if name:
        new_map = map_service.create_new_map(name, current_user.id)
        map_service.invalidate_all_sidebar_caches()  # <-- дерево сайдбара изменилось
        main_logger.info(
            f"Map created: {name}, ID={new_map.id}, owner={current_user.username}"
        )
        return redirect(url_for("main.map_view", map_id=new_map.id))
    return redirect(url_for("main.dashboard"))


def _portal_viewport():
    """Read an optional view passed by the map link or its return button."""
    values = tuple(request.args.get(key, type=float) for key in ("pan_x", "pan_y", "zoom"))
    if any(value is None or not math.isfinite(value) for value in values):
        return None
    x, y, zoom = values
    if not (-1e9 <= x <= 1e9 and -1e9 <= y <= 1e9 and 0.1 <= zoom <= 5):
        return None
    return {"pan_x": x, "pan_y": y, "zoom": zoom}


@main_bp.route("/map/portal/<int:shape_id>")
@login_required
def follow_map_portal(shape_id):
    if not 0 < shape_id <= 2147483647:
        abort(404)
    portal = db.session.get(MapShape, shape_id)
    if not portal or portal.shape_type != "map_link" or portal.target_map_id is None:
        abort(404)
    if not can_view_map(portal.map_id) or not can_view_map(portal.target_map_id):
        abort(403)
    return redirect(url_for(
        "main.map_view", map_id=portal.target_map_id, via=portal.id,
        **(_portal_viewport() or {}),
    ))


@main_bp.route("/map/<int:map_id>")
@login_required
def map_view(map_id):
    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        abort(404)

    # Проверяем права через новую систему
    if not can_view_map(map_id):
        abort(403)

    # Сохраняем последнюю карту пользователя через сервис
    update_last_map_id(current_user.id, map_id)

    # Получаем или создаём настройки для этого пользователя и карты
    settings = map_service.get_user_settings(current_user.id, map_id)
    main_logger.info(
        f"Rendering map {map_id} for user {current_user.id}: pan=({settings.pan_x}, {settings.pan_y}), zoom={settings.zoom}"
    )

    viewport = None
    back_url = None
    portal_id = request.args.get("via", type=int)
    if portal_id and 0 < portal_id <= 2147483647:
        portal = db.session.get(MapShape, portal_id)
        if portal and portal.shape_type == "map_link" and portal.target_map_id == map_id and can_view_map(portal.map_id):
            back_url = url_for("main.map_view", map_id=portal.map_id, resume=1, **(_portal_viewport() or {}))
    elif request.args.get("resume") == "1":
        viewport = _portal_viewport()
    can_edit = can_edit_map(map_id)
    destinations = (
        sorted(
            (m for m in map_service.get_available_maps(current_user) if m.id != map_id),
            key=lambda m: (m.name.casefold(), m.id),
        )
        if can_edit or can_toggle_map_lock(map_id) else []
    )

    return render_template(
        "map_view.html",
        map=map_obj,
        is_operator=current_user.is_operator,
        can_edit=can_edit,
        can_toggle_lock=can_toggle_map_lock(map_id),
        user_pan_x=viewport["pan_x"] if viewport else settings.pan_x,
        user_pan_y=viewport["pan_y"] if viewport else settings.pan_y,
        user_zoom=viewport["zoom"] if viewport else settings.zoom,
        portal_back_url=back_url,
        portal_destinations=destinations,
        restore_exact_view=viewport is not None,
    )


@main_bp.route("/api/sidebar-maps")
@login_required
def get_sidebar_maps():
    data = map_service.get_sidebar_maps_data(current_user)
    return jsonify(data)


@main_bp.route("/api/map/<int:map_id>", methods=["DELETE"])
@login_required
def delete_map(map_id):
    if not can_delete_map(map_id):
        return jsonify({"error": "Доступ запрещён"}), 403

    map_obj = map_service.get_map_by_id(map_id)
    if not map_obj:
        return jsonify({"error": "Map not found"}), 404

    try:
        owner_id = map_obj.owner_id
        map_service.delete_map_and_cleanup(map_id, current_app)
        map_service.invalidate_all_sidebar_caches()
        return jsonify({"status": "deleted"})
    except Exception:
        main_logger.exception(f"Error deleting map {map_id}")
        return jsonify({"error": "Internal server error"}), 500
