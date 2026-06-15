import os
import sys
from datetime import timedelta

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev-secret-key-change-me"

    # Проверка SECRET_KEY в production
    if os.environ.get("FLASK_ENV") == "production" and SECRET_KEY == "dev-secret-key-change-me":
        print("⚠️  WARNING: Using default SECRET_KEY in production! Set SECRET_KEY environment variable.")
        print("   Generate a new key: python -c 'import secrets; print(secrets.token_hex(32))'")

    SESSION_REFRESH_EACH_REQUEST = True
    PERMANENT_SESSION_LIFETIME = timedelta(days=30)
    REMEMBER_COOKIE_DURATION = timedelta(days=30)
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_HTTPONLY = True
    WTF_CSRF_TIME_LIMIT = None

    # Поддержка PostgreSQL через DATABASE_URL
    if os.environ.get("DATABASE_URL"):
        SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL")
    else:
        SQLALCHEMY_DATABASE_URI = f'sqlite:///{os.path.join(BASE_DIR, "webnetmap.db")}'

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_TIMEZONE = True
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "False") == "True"
    DEBUG = os.environ.get("FLASK_DEBUG", "False") == "True"

    if os.environ.get("BEHIND_PROXY") == "True":
        USE_X_FORWARDED_HOST = True
        USE_X_FORWARDED_PORT = True

    UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads", "icons")
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024

    VERSION = "2.0.0"
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
    LOG_FOLDER = os.path.join(BASE_DIR, "logs")
    LOG_MAX_BYTES = 10 * 1024 * 1024
    LOG_BACKUP_COUNT = 5

    # Настройки пула соединений (только для PostgreSQL)
    # Устанавливаем в __init__ чтобы можно было переопределить в тестах
    def __init__(self):
        if os.environ.get("DATABASE_URL"):
            self.SQLALCHEMY_ENGINE_OPTIONS = {
                "pool_size": 30,
                "max_overflow": 50,
                "pool_recycle": 3600,
                "pool_pre_ping": True,
            }
        else:
            self.SQLALCHEMY_ENGINE_OPTIONS = {
                "pool_pre_ping": True,
            }

