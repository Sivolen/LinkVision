from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_socketio import SocketIO
from flask_migrate import Migrate

db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = "auth.login"
socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode="threading",
    ping_interval=30,
    ping_timeout=100,
    # max_http_buffer_size=1e8
    max_http_buffer_size=100_000_000,
)
migrate = Migrate()


def init_extensions(app):
    db.init_app(app)
    login_manager.init_app(app)
    socketio.init_app(app)
    migrate.init_app(app, db)
