from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_socketio import SocketIO

db = SQLAlchemy()
login_manager = LoginManager()
login_manager.login_view = 'auth.login'
socketio = SocketIO(cors_allowed_origins="*")

def init_extensions(app):
    db.init_app(app)
    login_manager.init_app(app)
    socketio.init_app(app)