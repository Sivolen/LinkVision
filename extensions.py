from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_socketio import SocketIO
from flask_migrate import Migrate

db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = 'auth.login'

# ✅ ИСПРАВЛЕНО: Добавлен async_mode='threading' для совместимости
socketio = SocketIO(cors_allowed_origins="*", async_mode='threading')
migrate = Migrate()

def init_extensions(app):
    db.init_app(app)
    login_manager.init_app(app)
    socketio.init_app(app)
    migrate.init_app(app, db)