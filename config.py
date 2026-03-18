import os
from datetime import timedelta

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-me'
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or f'sqlite:///{os.path.join(BASE_DIR, "webnetmap.db")}'
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'static', 'uploads', 'icons')
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max upload

    SESSION_COOKIE_SECURE = False
    PERMANENT_SESSION_LIFETIME = timedelta(days=1)

    VERSION = '1.3.2'

    # Логирование
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')  # INFO, WARNING, DEBUG
    LOG_FOLDER = os.path.join(BASE_DIR, 'logs')
    LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
    LOG_BACKUP_COUNT = 5
