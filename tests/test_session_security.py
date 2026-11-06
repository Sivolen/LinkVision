from extensions import db, socketio
from models import User
from services.session_security import load_session_user, SocketSessionWatcher


def test_temporary_password_blocks_pages_and_api(app, client, login):
    with app.app_context():
        user = User.query.filter_by(username="admin").first()
        user.must_change_password = True
        db.session.commit()
    login("admin")
    response = client.get("/admin/users")
    assert response.status_code == 302
    assert response.location.endswith("/auth/change-password")
    assert client.get("/api/sidebar-maps").status_code == 403
    assert client.get("/auth/change-password").status_code == 200
    assert client.post("/auth/logout").status_code == 302


def test_password_reset_revokes_existing_session(app, client, login, monkeypatch):
    import manage

    login("admin")
    assert client.get("/admin/users").status_code == 200
    monkeypatch.setattr(
        manage, "_prompt_password", lambda username: "ResetForReview123!"
    )
    with app.app_context():
        assert manage._reset_admin_password("admin") == 0
    response = client.get("/admin/users")
    assert response.status_code == 302
    assert "/auth/login" in response.location


def test_legacy_and_malformed_login_ids_are_rejected(app):
    with app.app_context():
        user = User.query.filter_by(username="admin").first()
        assert load_session_user(user.get_id()).id == user.id
        for value in (str(user.id), "invalid", "1:wrong", None):
            assert load_session_user(value) is None


def test_password_change_keeps_current_session_and_revokes_other(app, client, login):
    login("admin")
    other = app.test_client()
    with client.session_transaction() as original:
        session_id = original["_user_id"]
    with other.session_transaction() as session:
        session["_user_id"] = session_id
        session["_fresh"] = True
    response = client.post(
        "/auth/change-password",
        data={
            "current_password": "Admin123!",
            "new_password": "DifferentPass123!",
            "confirm": "DifferentPass123!",
        },
    )
    assert response.status_code == 302
    assert client.get("/admin/users").status_code == 200
    assert "/auth/login" in other.get("/admin/users").location


def test_shared_watcher_disconnects_only_invalid_sessions(app, monkeypatch):
    from sqlalchemy import event

    watcher = SocketSessionWatcher(app)
    tasks = []
    disconnected = []
    monkeypatch.setattr(
        socketio, "start_background_task", lambda task: tasks.append(task)
    )
    monkeypatch.setattr(
        socketio.server, "disconnect", lambda sid, namespace: disconnected.append(sid)
    )
    with app.app_context():
        admin = User.query.filter_by(username="admin").first()
        other = User.query.filter_by(username="testuser").first()
        admin_id, other_id = admin.id, other.id
        admin_session, other_session = admin.get_id(), other.get_id()

    watcher.register("admin-1", admin_session)
    watcher.register("admin-2", admin_session)
    watcher.register("other", other_session)
    assert len(tasks) == 1

    queries = []
    with app.app_context():

        def count_queries(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("SELECT"):
                queries.append(statement)

        event.listen(db.engine, "before_cursor_execute", count_queries)
        watcher.check_sessions()
        event.remove(db.engine, "before_cursor_execute", count_queries)
        assert len(queries) == 1
        assert disconnected == []
        admin = db.session.get(User, admin_id)
        admin.set_password("ResetSocket123!")
        db.session.commit()

    watcher.check_sessions()
    assert set(disconnected) == {"admin-1", "admin-2"}
    assert watcher._sessions == {"other": other_session}
    watcher.unregister("other")
    assert not watcher._sessions


def test_watcher_rejects_password_change_and_deleted_user(app, monkeypatch):
    watcher = SocketSessionWatcher(app)
    disconnected = []
    monkeypatch.setattr(socketio, "start_background_task", lambda task: None)
    monkeypatch.setattr(
        socketio.server, "disconnect", lambda sid, namespace: disconnected.append(sid)
    )
    with app.app_context():
        admin = User.query.filter_by(username="admin").first()
        other = User.query.filter_by(username="testuser").first()
        watcher.register("forced", admin.get_id())
        watcher.register("deleted", other.get_id())
        admin.must_change_password = True
        db.session.delete(other)
        db.session.commit()
    watcher.check_sessions()
    assert set(disconnected) == {"forced", "deleted"}


def test_watcher_restarts_after_last_socket_disconnects(app, monkeypatch):
    watcher = SocketSessionWatcher(app)
    tasks = []
    monkeypatch.setattr(
        socketio, "start_background_task", lambda task: tasks.append(task)
    )
    monkeypatch.setattr(socketio, "sleep", lambda seconds: None)
    with app.app_context():
        session_id = User.query.filter_by(username="admin").first().get_id()
    watcher.register("first", session_id)
    watcher.unregister("first")
    tasks[0]()
    assert not watcher._running
    watcher.register("second", session_id)
    assert watcher._running and len(tasks) == 2
