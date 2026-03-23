import os
import uuid
import imghdr
from werkzeug.utils import secure_filename

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'svg'}
MAX_FILE_SIZE = 16 * 1024 * 1024  # 16 MB


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_image(file):
    """Проверяет, является ли файл изображением."""
    if not file:
        return False

    # Проверка размера
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_SIZE:
        return False

    # Читаем начало файла для определения типа
    file_head = file.read(1024)
    file.seek(0)

    # Проверка через imghdr
    img_type = imghdr.what(None, h=file_head)
    if img_type is not None and img_type.lower() in ALLOWED_EXTENSIONS:
        return True

    # Проверка SVG по сигнатуре
    if file_head.startswith(b'<?xml') or file_head.startswith(b'<svg'):
        return 'svg' in ALLOWED_EXTENSIONS

    return False


def safe_save_upload(file, folder, prefix=''):
    """
    Безопасно сохраняет загруженный файл.
    Возвращает имя сохранённого файла или None.
    """
    if not file or not allowed_file(file.filename):
        return None
    if not validate_image(file):
        return None

    # Генерируем уникальное имя, сохраняя расширение
    _, ext = os.path.splitext(secure_filename(file.filename))
    unique_name = f"{prefix}{uuid.uuid4().hex}{ext}" if prefix else f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(folder, unique_name)
    try:
        file.save(file_path)
        return unique_name
    except Exception:
        return None
