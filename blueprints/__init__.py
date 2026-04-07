from .auth import auth_bp
from .admin import admin_bp
from .main import main_bp
from .api import api_bp

__all__ = ["auth_bp", "admin_bp", "main_bp", "api_bp"]
