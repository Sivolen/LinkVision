import os
from flask import current_app
from werkzeug.utils import secure_filename
from models import DeviceType, db
from utils.file_validation import safe_save_upload
from utils.logger import admin_logger


def get_all_device_types():
    """Получить все типы устройств."""
    return DeviceType.query.all()


def get_device_type_by_id(type_id):
    """Получить тип устройства по ID."""
    return DeviceType.query.get(type_id)


def create_device_type(name, width=None, height=None, icon_file=None):
    filename = None
    if icon_file and icon_file.filename:
        upload_folder = current_app.config["UPLOAD_FOLDER"]
        saved_name = safe_save_upload(icon_file, upload_folder)
        if saved_name:
            filename = saved_name
        else:
            raise ValueError("Недопустимый файл иконки")

    dtype = DeviceType(
        name=name,
        icon_filename=filename,
        width=int(width) if width else None,
        height=int(height) if height else None,
    )
    db.session.add(dtype)
    db.session.commit()
    admin_logger.info(f"Device type created: {name}")
    return dtype


def update_device_type(type_id, name=None, width=None, height=None, icon_file=None):
    dtype = DeviceType.query.get_or_404(type_id)
    if name is not None:
        dtype.name = name
    dtype.width = int(width) if width else None
    dtype.height = int(height) if height else None

    if icon_file and icon_file.filename:
        # Удаляем старую иконку
        if dtype.icon_filename:
            old_path = os.path.join(
                current_app.config["UPLOAD_FOLDER"], dtype.icon_filename
            )
            if os.path.exists(old_path):
                os.remove(old_path)
        # Сохраняем новую
        saved_name = safe_save_upload(icon_file, current_app.config["UPLOAD_FOLDER"])
        if saved_name:
            dtype.icon_filename = saved_name
        else:
            raise ValueError("Недопустимый файл иконки")

    db.session.commit()
    admin_logger.info(f"Device type updated: ID={type_id}")
    return dtype


def delete_device_type(type_id):
    """Удалить тип устройства и его иконку."""
    dtype = DeviceType.query.get_or_404(type_id)
    if dtype.icon_filename:
        icon_path = os.path.join(
            current_app.config["UPLOAD_FOLDER"], dtype.icon_filename
        )
        if os.path.exists(icon_path):
            os.remove(icon_path)
    db.session.delete(dtype)
    db.session.commit()
    admin_logger.info(f"Device type deleted: ID={type_id}")
    return type_id
