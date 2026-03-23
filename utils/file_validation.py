import os
import uuid
from werkzeug.utils import secure_filename
from PIL import Image

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'svg'}
MAX_FILE_SIZE = 16 * 1024 * 1024  # 16 MB


def allowed_file(filename):
    """Проверяет расширение файла."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_image(file):
    """Проверяет, является ли файл изображением (по сигнатуре и через Pillow)."""
    if not file:
        return False

    # Проверка размера
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_SIZE:
        return False

    # Проверка через Pillow (безопасное открытие)
    try:
        img = Image.open(file)
        img.verify()  # Проверка на корректность изображения
        file.seek(0)  # Возвращаем указатель в начало
    except Exception:
        return False

    # Дополнительная проверка сигнатур для SVG (Pillow не поддерживает SVG)
    head = file.read(1024)
    file.seek(0)
    if head.startswith(b'<?xml') or head.startswith(b'<svg'):
        return 'svg' in ALLOWED_EXTENSIONS

    # Для остальных форматов достаточно проверки Pillow
    return True


def safe_save_upload(file, folder, prefix=''):
    if not file or not allowed_file(file.filename):
        return None
    if not validate_image(file):
        return None

    _, ext = os.path.splitext(secure_filename(file.filename))
    unique_name = f"{prefix}{uuid.uuid4().hex}{ext}" if prefix else f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(folder, unique_name)
    try:
        file.save(file_path)
        return unique_name
    except Exception:
        return None
