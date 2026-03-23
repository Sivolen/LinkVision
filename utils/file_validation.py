import os
import uuid
from werkzeug.utils import secure_filename

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'svg'}
MAX_FILE_SIZE = 16 * 1024 * 1024  # 16 MB


def allowed_file(filename):
    """Проверяет расширение файла."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_image(file):
    """Проверяет, является ли файл изображением (по сигнатуре)."""
    if not file:
        return False

    # Проверка размера
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_SIZE:
        return False

    # Читаем начало файла
    head = file.read(1024)
    file.seek(0)

    # Проверка сигнатур основных форматов
    # PNG
    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png' in ALLOWED_EXTENSIONS
    # JPEG
    if head.startswith(b'\xff\xd8\xff'):
        return 'jpg' in ALLOWED_EXTENSIONS or 'jpeg' in ALLOWED_EXTENSIONS
    # GIF
    if head.startswith(b'GIF87a') or head.startswith(b'GIF89a'):
        return 'gif' in ALLOWED_EXTENSIONS
    # BMP
    if head.startswith(b'BM'):
        return 'bmp' in ALLOWED_EXTENSIONS
    # WEBP
    if head.startswith(b'RIFF') and head[8:12] == b'WEBP':
        return 'webp' in ALLOWED_EXTENSIONS
    # SVG (текстовый XML или SVG)
    if head.startswith(b'<?xml') or head.startswith(b'<svg'):
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

    _, ext = os.path.splitext(secure_filename(file.filename))
    unique_name = f"{prefix}{uuid.uuid4().hex}{ext}" if prefix else f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(folder, unique_name)
    try:
        file.save(file_path)
        return unique_name
    except Exception:
        return None
