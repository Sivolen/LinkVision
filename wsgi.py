import os

from app import create_app
from extensions import socketio

app = create_app()

if __name__ == '__main__':
    os.makedirs('static/uploads/icons', exist_ok=True)
    application = create_app()
    # Используем настройку DEBUG из конфигурации
    debug_mode = application.config['DEBUG']
    socketio.run(application, debug=debug_mode, use_reloader=False,
                 port=5000, host="0.0.0.0", allow_unsafe_werkzeug=True)