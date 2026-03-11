from flask import Flask, request
from flask_socketio import join_room
from config import Config
from extensions import db, login_manager, socketio, init_extensions
from models import User, Map, DeviceType, Settings, Device
from blueprints.auth import auth_bp
from blueprints.admin import admin_bp
from blueprints.main import main_bp
from blueprints.api import api_bp
from monitor import init_monitor, start_monitor
import os

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    init_extensions(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    with app.app_context():
        db.create_all()

        if not User.query.filter_by(username='admin').first():
            admin = User(username='admin', is_admin=True)
            admin.set_password('admin')
            db.session.add(admin)

            db.session.add(Settings(key='ping_count', value='4'))
            db.session.add(Settings(key='ping_interval', value='10'))

            db.session.add(DeviceType(name='Router', icon_filename=''))
            db.session.add(DeviceType(name='Switch', icon_filename=''))
            db.session.add(DeviceType(name='Server', icon_filename=''))
            db.session.add(DeviceType(name='PC', icon_filename=''))

            db.session.commit()
            print("✅ Admin created: admin / admin")

        init_monitor(app)

    @socketio.on('join_room')
    def handle_join_room(room):
        join_room(room)
        print(f"✅ Клиент присоединился к комнате {room}")

    @socketio.on('connect')
    def handle_connect():
        print(f"✅ Клиент подключился: {request.sid}")

    @socketio.on('disconnect')
    def handle_disconnect():
        print(f"❌ Клиент отключился: {request.sid}")

    start_monitor()

    @app.route('/static/uploads/maps/<path:filename>')
    def serve_map_background(filename):
        from flask import send_from_directory
        maps_dir = os.path.join(app.root_path, 'static', 'uploads', 'maps')
        return send_from_directory(maps_dir, filename)

    @app.route('/static/uploads/icons/<path:filename>')
    def serve_icon(filename):
        from flask import send_from_directory
        icons_dir = os.path.join(app.root_path, 'static', 'uploads', 'icons')
        return send_from_directory(icons_dir, filename)

    return app

if __name__ == '__main__':
    os.makedirs('static/uploads/icons', exist_ok=True)
    app = create_app()
    # ✅ Отключаем reloader, чтобы избежать двух процессов мониторинга
    socketio.run(app, debug=True, use_reloader=False, port=5000, allow_unsafe_werkzeug=True)