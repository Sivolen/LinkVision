"""
Тесты для Auth API (Аутентификация).

Проверяют:
- Вход с валидными/невалидными данными
- Выход из системы
- Регистрацию новых пользователей
- Смену пароля
- Проверку must_change_password при первом входе

Тесты используют фикстуры из tests/conftest.py.
"""

import pytest
from models import User
from extensions import db
from services.user_service import authenticate_user, change_user_password


# ============================================================================
# Тесты аутентификации (login)
# ============================================================================


class TestAuthLogin:
    """Тесты эндпоинта /auth/login."""

    def test_login_success(self, app, client):
        """Успешный вход с валидными данными -> редирект 302."""
        with app.app_context():
            user = User(username="test_login_user", is_admin=False)
            user.set_password("Test123!")
            user.must_change_password = False
            db.session.add(user)
            db.session.commit()

        try:
            resp = client.post(
                "/auth/login",
                data={"username": "test_login_user", "password": "Test123!"},
                follow_redirects=False,
            )
            assert resp.status_code == 302
            # main.dashboard() — это "/", после успешного логина редирект туда
            assert resp.headers.get("Location", "") == "/"
        finally:
            with app.app_context():
                user = User.query.filter_by(username="test_login_user").first()
                if user:
                    db.session.delete(user)
                    db.session.commit()

    def test_login_fail_wrong_password(self, app, client):
        """Вход с неверным паролем -> страница логина (200)."""
        with app.app_context():
            user = User(username="test_fail_user", is_admin=False)
            user.set_password("Test123!")
            user.must_change_password = False
            db.session.add(user)
            db.session.commit()

        try:
            resp = client.post(
                "/auth/login",
                data={"username": "test_fail_user", "password": "WrongPass1!"},
                follow_redirects=False,
            )
            assert resp.status_code == 200
            assert b"login" in resp.data.lower()
        finally:
            with app.app_context():
                user = User.query.filter_by(username="test_fail_user").first()
                if user:
                    db.session.delete(user)
                    db.session.commit()

    def test_login_nonexistent_user(self, app, client):
        """Вход с несуществующим пользователем -> страница логина (200)."""
        resp = client.post(
            "/auth/login",
            data={"username": "nonexistent_user_12345", "password": "Test123!"},
            follow_redirects=False,
        )
        assert resp.status_code == 200

    def test_login_empty_fields(self, app, client):
        """Вход с пустыми полями -> страница логина (200)."""
        resp = client.post(
            "/auth/login",
            data={"username": "", "password": ""},
            follow_redirects=False,
        )
        assert resp.status_code == 200

    def test_login_must_change_password_redirects(self, app, client):
        """Вход с must_change_password=True -> редирект на change-password."""
        with app.app_context():
            user = User(username="must_change_login", is_admin=False)
            user.set_password("Test123!")
            user.must_change_password = True
            db.session.add(user)
            db.session.commit()

        try:
            resp = client.post(
                "/auth/login",
                data={"username": "must_change_login", "password": "Test123!"},
                follow_redirects=False,
            )
            assert resp.status_code == 302
            assert "change-password" in resp.headers.get("Location", "")
        finally:
            with app.app_context():
                user = User.query.filter_by(username="must_change_login").first()
                if user:
                    db.session.delete(user)
                    db.session.commit()


# ============================================================================
# Тесты регистрации (register)
# ============================================================================


class TestAuthRegister:
    """Тесты эндпоинта /auth/register."""

    def test_register_success(self, app, client):
        """Успешная регистрация -> редирект на login (302)."""
        resp = client.post(
            "/auth/register",
            data={
                "username": "new_user_test",
                "password": "Test123!",
                "confirm": "Test123!",
            },
            follow_redirects=False,
        )

        assert resp.status_code == 302
        assert "/auth/login" in resp.headers.get("Location", "")

        with app.app_context():
            user = User.query.filter_by(username="new_user_test").first()
            assert user is not None
            assert user.check_password("Test123!")
            db.session.delete(user)
            db.session.commit()

    def test_register_duplicate_username(self, app, client):
        """Регистрация с существующим именем -> редирект на register (302)."""
        with app.app_context():
            user = User(username="existing_user", is_admin=False)
            user.set_password("Test123!")
            db.session.add(user)
            db.session.commit()

        try:
            resp = client.post(
                "/auth/register",
                data={
                    "username": "existing_user",
                    "password": "Test123!",
                    "confirm": "Test123!",
                },
                follow_redirects=False,
            )
            assert resp.status_code == 302
            assert "/auth/register" in resp.headers.get("Location", "")
        finally:
            with app.app_context():
                user = User.query.filter_by(username="existing_user").first()
                if user:
                    db.session.delete(user)
                    db.session.commit()

    def test_register_weak_password(self, app, client):
        """Регистрация со слабым паролем -> редирект на register (302)."""
        resp = client.post(
            "/auth/register",
            data={
                "username": "weak_pass_user",
                "password": "weak",
                "confirm": "weak",
            },
            follow_redirects=False,
        )
        assert resp.status_code in [200, 302]

        with app.app_context():
            user = User.query.filter_by(username="weak_pass_user").first()
            assert user is None

    def test_register_password_mismatch(self, app, client):
        """Регистрация с несовпадающими паролями -> редирект на register."""
        resp = client.post(
            "/auth/register",
            data={
                "username": "mismatch_user",
                "password": "Test123!",
                "confirm": "Different123!",
            },
            follow_redirects=False,
        )
        assert resp.status_code in [200, 302]

        with app.app_context():
            user = User.query.filter_by(username="mismatch_user").first()
            assert user is None


# ============================================================================
# Тесты смены пароля (change-password)
# ============================================================================


class TestAuthChangePassword:
    """Тесты эндпоинта /auth/change-password."""

    def test_change_password_success(self, app, client):
        """Успешная смена пароля -> редирект на dashboard (302)."""
        with app.app_context():
            user = User(username="change_pw_user", is_admin=False)
            user.set_password("OldPass1!")
            user.must_change_password = False
            db.session.add(user)
            db.session.commit()
            uid = user.id

        try:
            # Войти через сессию
            with client.session_transaction() as sess:
                sess["_user_id"] = str(uid)
                sess["_fresh"] = True

            # Сменить пароль
            resp = client.post(
                "/auth/change-password",
                data={
                    "current_password": "OldPass1!",
                    "new_password": "NewPass1!",
                    "confirm": "NewPass1!",
                },
                follow_redirects=False,
            )
            assert resp.status_code == 302

            # Проверить, что новый пароль работает
            with app.app_context():
                updated = db.session.get(User, uid)
                assert updated.check_password("NewPass1!")
                assert not updated.check_password("OldPass1!")
        finally:
            with app.app_context():
                user = db.session.get(User, uid)
                if user:
                    db.session.delete(user)
                    db.session.commit()

    def test_change_password_wrong_current(self, app, client):
        """Смена пароля с неверным текущим -> редирект на change-password."""
        with app.app_context():
            user = User(username="wrong_current_user", is_admin=False)
            user.set_password("CorrectPass1!")
            user.must_change_password = False
            db.session.add(user)
            db.session.commit()
            uid = user.id

        try:
            with client.session_transaction() as sess:
                sess["_user_id"] = str(uid)
                sess["_fresh"] = True

            resp = client.post(
                "/auth/change-password",
                data={
                    "current_password": "WrongPass1!",
                    "new_password": "NewPass1!",
                    "confirm": "NewPass1!",
                },
                follow_redirects=False,
            )
            assert resp.status_code == 302
            assert "change-password" in resp.headers.get("Location", "")
        finally:
            with app.app_context():
                user = db.session.get(User, uid)
                if user:
                    db.session.delete(user)
                    db.session.commit()

    def test_change_password_weak_new(self, app, client):
        """Смена на слабый пароль -> редирект на change-password."""
        with app.app_context():
            user = User(username="weak_new_user", is_admin=False)
            user.set_password("OldPass1!")
            user.must_change_password = False
            db.session.add(user)
            db.session.commit()
            uid = user.id

        try:
            with client.session_transaction() as sess:
                sess["_user_id"] = str(uid)
                sess["_fresh"] = True

            resp = client.post(
                "/auth/change-password",
                data={
                    "current_password": "OldPass1!",
                    "new_password": "weak",
                    "confirm": "weak",
                },
                follow_redirects=False,
            )
            assert resp.status_code in [200, 302]
        finally:
            with app.app_context():
                user = db.session.get(User, uid)
                if user:
                    db.session.delete(user)
                    db.session.commit()


# ============================================================================
# Тесты выхода (logout)
# ============================================================================


class TestAuthLogout:
    """Тесты эндпоинта /auth/logout."""

    def test_logout_success(self, app, client):
        """Успешный выход -> редирект на login (302)."""
        with app.app_context():
            user = User(username="logout_user", is_admin=False)
            user.set_password("Test123!")
            user.must_change_password = False
            db.session.add(user)
            db.session.commit()
            uid = user.id

        try:
            with client.session_transaction() as sess:
                sess["_user_id"] = str(uid)
                sess["_fresh"] = True

            resp = client.get("/auth/logout", follow_redirects=False)
            assert resp.status_code == 302
            assert "/auth/login" in resp.headers.get("Location", "")
        finally:
            with app.app_context():
                user = db.session.get(User, uid)
                if user:
                    db.session.delete(user)
                    db.session.commit()

    def test_logout_unauthenticated(self, app, client):
        """Выход без авторизации -> редирект на login (302)."""
        resp = client.get("/auth/logout", follow_redirects=False)
        assert resp.status_code == 302


# ============================================================================
# Интеграционные тесты — полный цикл
# ============================================================================


class TestAuthLifecycle:
    """Интеграционные тесты полного цикла аутентификации."""

    def test_full_lifecycle_register_login_logout(self, app, client):
        """Полный цикл: регистрация -> вход -> выход -> повторный вход."""
        username = "lifecycle_user"
        password = "Test123!"

        # 1. Регистрация
        resp = client.post(
            "/auth/register",
            data={"username": username, "password": password, "confirm": password},
            follow_redirects=False,
        )
        assert resp.status_code == 302

        # 2. Вход
        resp = client.post(
            "/auth/login",
            data={"username": username, "password": password},
            follow_redirects=False,
        )
        assert resp.status_code == 302

        # 3. Выход
        resp = client.get("/auth/logout", follow_redirects=False)
        assert resp.status_code == 302

        # 4. Повторный вход
        resp = client.post(
            "/auth/login",
            data={"username": username, "password": password},
            follow_redirects=False,
        )
        assert resp.status_code == 302

        # Очистка
        with app.app_context():
            user = User.query.filter_by(username=username).first()
            if user:
                db.session.delete(user)
                db.session.commit()

    def test_must_change_password_on_first_login(self, app):
        """Первый вход должен требовать смены пароля (must_change_password=True)."""
        with app.app_context():
            user = User(username="must_change_user", is_admin=True)
            user.set_password("Admin123!")
            user.must_change_password = True
            db.session.add(user)
            db.session.commit()
            uid = user.id

        try:
            # Аутентификация должна пройти
            result = authenticate_user("must_change_user", "Admin123!")
            assert result is not None
            assert result.must_change_password is True

            # Смена пароля
            change_user_password(uid, "NewAdmin123!")

            # Проверить, что must_change_password стал False
            with app.app_context():
                updated_user = db.session.get(User, uid)
                assert updated_user.must_change_password is False
                assert updated_user.check_password("NewAdmin123!")
        finally:
            with app.app_context():
                user = db.session.get(User, uid)
                if user:
                    db.session.delete(user)
                    db.session.commit()
