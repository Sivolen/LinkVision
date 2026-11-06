"""Shared session validation for HTTP and Socket.IO."""

import hmac

from flask import g, jsonify, redirect, request, url_for
from flask_login import current_user
from extensions import db, socketio
from models import User


def load_session_user(session_id):
    try:
        user_id, _digest = str(session_id).split(":", 1)
        user = db.session.get(User, int(user_id), populate_existing=True)
    except (ValueError, TypeError):
        return None
    if user and hmac.compare_digest(user.get_id().encode(), str(session_id).encode()):
        return user
    return None


def enforce_password_change():
    # Always resolve the principal for this request, even if a surrounding
    # application context previously cached a Flask-Login user.
    g.pop("_login_user", None)
    allowed = {"static", "auth.change_password", "auth.logout", "i18n.set_language"}
    if request.endpoint in allowed or not current_user.is_authenticated:
        return None
    if not current_user.must_change_password:
        return None
    if request.path.startswith("/api/"):
        return jsonify(error="password_change_required"), 403
    return redirect(url_for("auth.change_password"))


def socket_user_allowed(session_id):
    user = load_session_user(session_id)
    return user is not None and not user.must_change_password


def watch_socket_session(app, sid, session_id):
    while socketio.server.manager.is_connected(sid, "/"):
        socketio.sleep(5)
        with app.app_context():
            allowed = socket_user_allowed(session_id)
        if not allowed:
            socketio.server.disconnect(sid, namespace="/")
            return
