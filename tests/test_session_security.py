from extensions import db, socketio
from models import User
from services.session_security import load_session_user, watch_socket_session


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


def test_socket_watchdog_disconnects_after_password_reset(app, monkeypatch):
    with app.app_context():
        user = User.query.filter_by(username="admin").first()
        session_id = user.get_id()

    def reset_password(_seconds):
        with app.app_context():
            user = User.query.filter_by(username="admin").first()
            user.set_password("ResetSocket123!")
            db.session.commit()

    disconnected = []
    monkeypatch.setattr(socketio, "sleep", reset_password)
    monkeypatch.setattr(socketio.server.manager, "is_connected", lambda *args: True)
    monkeypatch.setattr(
        socketio.server, "disconnect", lambda sid, namespace: disconnected.append(sid)
    )
    watch_socket_session(app, "review-socket", session_id)
    assert disconnected == ["review-socket"]
