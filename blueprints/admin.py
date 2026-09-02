import os
import shutil
import sqlite3
import tempfile
from datetime import datetime
from flask import (
    Blueprint,
    render_template,
    request,
    redirect,
    url_for,
    flash,
    current_app,
    abort,
    send_file,
)
from flask_babel import gettext as _
from flask_login import login_required, current_user
from models import Map, db
from services import user_service, device_type_service, settings_service, map_service
from services.security_service import rate_limiter
from services.device_type_service import invalidate_types_cache
from utils.logger import admin_logger

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


@admin_bp.before_request
def check_admin():
    if not current_user.is_authenticated or not current_user.is_admin:
        flash(_("Доступ запрещен. Требуются права администратора."))
        return redirect(url_for("main.dashboard"))
    return None  # явное возвращение None для продолжения запроса


# ============================================================================
# Управление пользователями
# ============================================================================


@admin_bp.route("/users")
def users():
    all_users = user_service.get_all_users()
    return render_template("admin/users.html", users=all_users)


@admin_bp.route("/users/create", methods=["POST"])
def create_user():
    username = request.form.get("username")
    password = request.form.get("password")
    role = request.form.get("role")  # 'user', 'operator', 'admin'

    if not username or not password:
        flash(_("Имя пользователя и пароль обязательны"))
        return redirect(url_for("admin.users"))

    if user_service.get_user_by_username(username):
        flash(_("Пользователь с таким именем уже существует"))
        return redirect(url_for("admin.users"))

    try:
        user_service.create_user(username, password, role)
        flash(_("Пользователь создан"))
    except Exception as e:
        admin_logger.error(f"Error creating user: {e}")
        flash(_("Ошибка при создании пользователя"))
    return redirect(url_for("admin.users"))


@admin_bp.route("/users/delete/<int:id>", methods=["POST"])
def delete_user(id):
    user = user_service.get_user_by_id(id)
    if not user:
        flash(_("Пользователь не найден"))
        return redirect(url_for("admin.users"))

    if user.id == current_user.id:
        flash(_("Нельзя удалить самого себя"))
        return redirect(url_for("admin.users"))

    try:
        user_service.delete_user(id)
        flash(_("Пользователь удалён"))
    except Exception as e:
        admin_logger.error(f"Error deleting user: {e}")
        flash(_("Ошибка при удалении пользователя"))
    return redirect(url_for("admin.users"))


@admin_bp.route("/users/edit/<int:id>", methods=["GET", "POST"])
def edit_user(id):
    user = user_service.get_user_by_id(id)
    if not user:
        abort(404)

    if request.method == "POST":
        username = request.form.get("username")
        password = request.form.get("password")
        role = request.form.get("role")

        if not username:
            flash(_("Имя пользователя обязательно"))
            return redirect(url_for("admin.edit_user", id=id))

        # Проверка уникальности имени
        existing = user_service.get_user_by_username(username)
        if existing and existing.id != id:
            flash(_("Пользователь с таким именем уже существует"))
            return redirect(url_for("admin.edit_user", id=id))

        try:
            user_service.update_user(
                id, username=username, password=password, role=role
            )
            flash(_("Пользователь обновлён"))
            return redirect(url_for("admin.users"))
        except Exception as e:
            admin_logger.error(f"Error updating user: {e}")
            flash(_("Ошибка при обновлении пользователя"))

    # GET: показываем форму редактирования
    return render_template(
        "admin/users.html", edit_user=user, users=user_service.get_all_users()
    )


# ============================================================================
# Управление типами устройств
# ============================================================================


@admin_bp.route("/types")
def types():
    all_types = device_type_service.get_all_device_types()
    return render_template("admin/types.html", types=all_types)


@admin_bp.route("/types/create", methods=["POST"])
def create_type():
    name = request.form.get("name")
    width = request.form.get("width")
    height = request.form.get("height")
    icon = request.files.get("icon")

    if not name:
        flash(_("Название типа обязательно"))
        return redirect(url_for("admin.types"))

    try:
        device_type_service.create_device_type(name, width, height, icon)
        invalidate_types_cache()
        flash(_("Тип устройства создан"))
    except Exception as e:
        admin_logger.error(f"Error creating device type: {e}")
        flash(_("Ошибка при создании типа"))
    return redirect(url_for("admin.types"))


@admin_bp.route("/types/<int:id>/edit", methods=["GET", "POST"])
def edit_type(id):
    dtype = device_type_service.get_device_type_by_id(id)
    if not dtype:
        abort(404)

    if request.method == "POST":
        name = request.form.get("name")
        width = request.form.get("width")
        height = request.form.get("height")
        icon = request.files.get("icon")

        try:
            device_type_service.update_device_type(id, name, width, height, icon)
            invalidate_types_cache()
            flash(_("Тип устройства обновлён"))
            return redirect(url_for("admin.types"))
        except Exception as e:
            admin_logger.error(f"Error updating device type: {e}")
            flash(_("Ошибка при обновлении типа"))

    all_types = device_type_service.get_all_device_types()
    return render_template("admin/types.html", types=all_types, edit_type=dtype)


@admin_bp.route("/types/<int:id>/delete", methods=["POST"])
def delete_type(id):
    try:
        device_type_service.delete_device_type(id)
        invalidate_types_cache()
        flash(_("Тип устройства удалён"))
    except Exception as e:
        admin_logger.error(f"Error deleting device type: {e}")
        flash(_("Ошибка при удалении типа"))
    return redirect(url_for("admin.types"))


# ============================================================================
# Настройки
# ============================================================================


@admin_bp.route("/settings", methods=["GET", "POST"])
def settings():
    # Информация о БД
    db_path = current_app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")
    if not db_path.startswith("/"):
        db_path = os.path.join(current_app.root_path, db_path)

    if os.path.exists(db_path):
        db_size = os.path.getsize(db_path)
        db_mtime = datetime.fromtimestamp(os.path.getmtime(db_path))
    else:
        db_size = 0
        db_mtime = None

    if request.method == "POST":
        if "ping_count" in request.form:
            ping_count = request.form.get("ping_count")
            ping_interval = request.form.get("ping_interval")
            try:
                settings_service.update_ping_settings(ping_count, ping_interval)
                flash(_("Настройки сохранены"))
            except Exception as e:
                admin_logger.error(f"Error updating settings: {e}")
                flash(_("Ошибка при сохранении настроек"))
            return redirect(url_for("admin.settings"))
        elif "restore_backup" in request.form:
            return restore_backup_action()
        elif "reset_rate_limit" in request.form:
            rate_limiter.reset_all()
            flash(_("Счётчики rate limit успешно сброшены"), "success")
            return redirect(url_for("admin.settings"))

    ping_count, ping_interval = settings_service.get_ping_settings()
    return render_template(
        "admin/settings.html",
        count=ping_count,
        interval=ping_interval,
        db_size=db_size,
        db_mtime=db_mtime,
    )


# ============================================================================
# Управление картами
# ============================================================================


@admin_bp.route("/maps")
def maps_list():
    all_maps = Map.query.all()  # Пока оставим прямое обращение, можно вынести позже
    return render_template("admin/maps.html", maps=all_maps)


@admin_bp.route("/maps/delete/<int:id>", methods=["POST"])
def delete_map(id):
    try:
        map_service.delete_map_and_cleanup(id, current_app)
        admin_logger.info(f"Map deleted: ID={id}")
        flash(_("Карта удалена"))
    except Exception as e:
        admin_logger.error(f"Error deleting map: {e}")
        flash(_("Ошибка при удалении карты"))
    return redirect(url_for("admin.maps_list"))


# ============================================================================
# Вспомогательная функция для восстановления БД
# ============================================================================
def _validate_sqlite_backup(backup_path):
    """Проверяет резервную копию SQLite до замены рабочей БД.

    В проекте пока нет надёжного общего номера схемы для старых БД, поэтому
    сначала проверяем целостность SQLite и наличие всех таблиц/колонок,
    которые требуются текущей ORM-модели. Лишние колонки допустимы.
    """
    required_tables = {}
    for table in db.metadata.sorted_tables:
        required_tables[table.name] = {column.name for column in table.columns}

    conn = sqlite3.connect(backup_path)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()
        if not integrity or str(integrity[0]).lower() != "ok":
            return False, _("Файл базы данных повреждён или не является корректной SQLite-базой.")

        existing_tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }

        missing_tables = sorted(set(required_tables) - existing_tables)
        if missing_tables:
            return False, _(
                "Резервная копия несовместима с текущей версией LinkVision: отсутствуют таблицы ({tables}). Текущая база данных не изменена."
            ).format(tables=", ".join(missing_tables))

        missing_columns = []
        for table_name, required_columns in required_tables.items():
            columns = {
                row[1]
                for row in conn.execute(f'PRAGMA table_info("{table_name}")')
            }
            missing = sorted(required_columns - columns)
            if missing:
                missing_columns.append(f"{table_name}: {', '.join(missing)}")

        if missing_columns:
            return False, _(
                "Резервная копия создана в несовместимой версии LinkVision. Отсутствуют поля: {fields}. Текущая база данных не изменена."
            ).format(fields="; ".join(missing_columns))

        return True, None
    except sqlite3.DatabaseError as exc:
        admin_logger.error(f"SQLite backup validation failed: {exc}")
        return False, _("Не удалось проверить файл базы данных. Текущая база данных не изменена.")
    finally:
        conn.close()


def restore_backup_action():
    if "backup_file" not in request.files:
        flash(_("Файл не выбран"))
        return redirect(url_for("admin.settings"))

    file = request.files["backup_file"]
    if file.filename == "":
        flash(_("Пустой файл"))
        return redirect(url_for("admin.settings"))

    if not file.filename.lower().endswith(".db"):
        flash(_("Допустимы только файлы .db"))
        return redirect(url_for("admin.settings"))

    db_uri = current_app.config["SQLALCHEMY_DATABASE_URI"]
    if not db_uri.startswith("sqlite:///"):
        flash(_("Восстановление файла .db доступно только для SQLite."))
        return redirect(url_for("admin.settings"))

    db_path = db_uri.replace("sqlite:///", "", 1)
    if not os.path.isabs(db_path):
        db_path = os.path.join(current_app.root_path, db_path)
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    temp_path = None
    try:
        # Сначала сохраняем загруженный файл во временный путь. Рабочая БД
        # вообще не трогается, пока файл не прошёл все проверки.
        fd, temp_path = tempfile.mkstemp(prefix="linkvision_restore_", suffix=".db", dir=os.path.dirname(db_path))
        os.close(fd)
        file.save(temp_path)

        valid, error_message = _validate_sqlite_backup(temp_path)
        if not valid:
            admin_logger.warning(f"Rejected incompatible database backup: {file.filename}")
            flash(error_message, "error")
            return redirect(url_for("admin.settings"))

        backup_path = db_path + ".bak"
        if os.path.exists(db_path):
            shutil.copy2(db_path, backup_path)

        # Закрываем старые SQLite-соединения до замены файла. После os.replace
        # SQLAlchemy получит новое соединение уже к восстановленной БД.
        db.session.remove()
        db.engine.dispose()
        os.replace(temp_path, db_path)
        temp_path = None
        db.engine.dispose()

        admin_logger.info("Database restored from uploaded file after schema validation")
        flash(
            _(
                "База данных успешно восстановлена. Резервная копия предыдущей БД сохранена как .bak."
            ),
            "success",
        )
    except Exception as e:
        admin_logger.error(f"Error restoring database: {e}", exc_info=True)
        flash(_("Ошибка при восстановлении базы данных. Текущая база данных не изменена."), "error")
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

    return redirect(url_for("admin.settings"))


@admin_bp.route("/backups/download")
@login_required
def download_backup():
    db_path = current_app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")
    if not db_path.startswith("/"):
        db_path = os.path.join(current_app.root_path, db_path)

    if not os.path.exists(db_path):
        abort(404)

    admin_logger.info("Backup downloaded")
    return send_file(db_path, as_attachment=True, download_name="webnetmap_backup.db")
