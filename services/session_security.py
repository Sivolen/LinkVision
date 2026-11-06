"""Shared session validation for HTTP and Socket.IO."""

import hmac
from threading import RLock

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


class SocketSessionWatcher:
    """One local watcher per application, with one query per batch of users."""

    CHECK_INTERVAL = 5
    QUERY_BATCH_SIZE = 500

    def __init__(self, app):
        self.app = app
        self._sessions = {}
        self._lock = RLock()
        self._running = False

    def register(self, sid, session_id):
        with self._lock:
            self._sessions[sid] = session_id
            if not self._running:
                self._running = True
                try:
                    socketio.start_background_task(self._run)
                except Exception:
                    self._running = False
                    self._sessions.pop(sid, None)
                    raise

    def unregister(self, sid):
        with self._lock:
            self._sessions.pop(sid, None)

    def check_sessions(self):
        with self._lock:
            snapshot = self._sessions.copy()
        if not snapshot:
            return

        ids = set()
        for session_id in snapshot.values():
            try:
                user_id, _ = str(session_id).split(":", 1)
                ids.add(int(user_id))
            except (TypeError, ValueError):
                pass

        users = {}
        with self.app.app_context():
            id_list = list(ids)
            for offset in range(0, len(id_list), self.QUERY_BATCH_SIZE):
                chunk = id_list[offset : offset + self.QUERY_BATCH_SIZE]
                rows = User.query.filter(User.id.in_(chunk)).populate_existing().all()
                users.update(
                    {
                        user.id: (user.get_id(), user.must_change_password)
                        for user in rows
                    }
                )

        for sid, session_id in snapshot.items():
            try:
                user_id = int(str(session_id).split(":", 1)[0])
                user = users.get(user_id)
                allowed = bool(
                    user
                    and not user[1]
                    and hmac.compare_digest(user[0].encode(), str(session_id).encode())
                )
            except (TypeError, ValueError):
                allowed = False
            if allowed:
                continue
            with self._lock:
                # A disconnect or replacement may have occurred during the query.
                if self._sessions.get(sid) != session_id:
                    continue
            try:
                socketio.server.disconnect(sid, namespace="/")
            except Exception:
                self.app.logger.exception("Could not disconnect invalid socket session")
                continue
            with self._lock:
                if self._sessions.get(sid) == session_id:
                    self._sessions.pop(sid, None)

    def _run(self):
        while True:
            socketio.sleep(self.CHECK_INTERVAL)
            try:
                self.check_sessions()
            except Exception:
                self.app.logger.exception("Socket session validation failed")
            with self._lock:
                if not self._sessions:
                    self._running = False
                    return
