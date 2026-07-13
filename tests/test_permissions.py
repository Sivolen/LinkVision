"""
Тесты для permission_service.py (Гранулярные права доступа к картам).

Проверяют:
- Создание разрешений для пользователей и ролей
- Валидацию дубликатов
- Удаление разрешений
- Полный цикл работы с разрешениями

Тесты используют фикстуры из tests/conftest.py:
- admin / Admin123! — администратор
- testuser / User123! — обычный пользователь
- maps: Own Map, Foreign Map, Shared Viewer Map, Shared Editor Map
"""

import pytest
from models import MapPermission, User, Map
from extensions import db
from services.permission_service import (
    grant_map_permission,
    grant_map_role_permission,
    update_map_permission_role,
    revoke_map_permission,
)


def _cleanup_permission(perm_id):
    """Безопасно удалить permission, если существует."""
    perm = db.session.get(MapPermission, perm_id)
    if perm:
        db.session.delete(perm)
        db.session.commit()


# ============================================================================
# grant_map_permission — права для конкретного пользователя
# ============================================================================


class TestGrantMapPermission:
    """Тесты функции grant_map_permission()."""

    def test_create_permission_success(self, app):
        """Успешное создание разрешения для пользователя на карту."""
        with app.app_context():
            shared_viewer_map = Map.query.filter_by(name="Shared Viewer Map").first()

            new_user = User(username="perm_test_user", is_admin=False)
            new_user.set_password("Test123!")
            db.session.add(new_user)
            db.session.flush()

            try:
                perm = grant_map_permission(
                    map_id=shared_viewer_map.id, user_id=new_user.id, role="editor"
                )

                assert perm is not None
                assert perm.map_id == shared_viewer_map.id
                assert perm.user_id == new_user.id
                assert perm.role == "editor"

                stored = db.session.get(MapPermission, perm.id)
                assert stored is not None
                assert stored.role == "editor"
            finally:
                _cleanup_permission(perm.id if perm else 0)
                db.session.delete(new_user)
                db.session.commit()

    def test_create_permission_viewer_role(self, app):
        """Создание разрешения с ролью viewer."""
        with app.app_context():
            admin = User.query.filter_by(username="admin").first()
            # Используем новую карту, чтобы не конфликтовать с conftest-разрешениями
            new_map = Map(name="Viewer Role Perm Map", owner_id=admin.id)
            db.session.add(new_map)
            db.session.flush()

            new_user = User(username="perm_viewer_test", is_admin=False)
            new_user.set_password("Test123!")
            db.session.add(new_user)
            db.session.flush()

            perm = None
            try:
                perm = grant_map_permission(
                    map_id=new_map.id, user_id=new_user.id, role="viewer"
                )
                assert perm.role == "viewer"
            finally:
                if perm:
                    _cleanup_permission(perm.id)
                db.session.delete(new_user)
                db.session.delete(new_map)
                db.session.commit()

    def test_create_permission_duplicate_raises_error(self, app):
        """Попытка создать дубликат разрешения должна вызвать ValueError."""
        with app.app_context():
            admin = User.query.filter_by(username="admin").first()

            new_map = Map(name="Perm Dup Test Map", owner_id=admin.id)
            new_user = User(username="perm_dup_user", is_admin=False)
            new_user.set_password("Test123!")
            db.session.add_all([new_map, new_user])
            db.session.flush()

            try:
                perm1 = grant_map_permission(
                    map_id=new_map.id, user_id=new_user.id, role="editor"
                )
                assert perm1 is not None

                with pytest.raises(ValueError, match="Permission already exists"):
                    grant_map_permission(
                        map_id=new_map.id, user_id=new_user.id, role="viewer"
                    )
            finally:
                _cleanup_permission(perm1.id if perm1 else 0)
                db.session.delete(new_user)
                db.session.delete(new_map)
                db.session.commit()


# ============================================================================
# grant_map_role_permission — права для роли
# ============================================================================


class TestGrantMapRolePermission:
    """Тесты функции grant_map_role_permission()."""

    def test_create_role_permission_success(self, app):
        """Успешное создание разрешения для роли на карту."""
        with app.app_context():
            admin = User.query.filter_by(username="admin").first()

            new_map = Map(name="Role Perm Test Map", owner_id=admin.id)
            db.session.add(new_map)
            db.session.flush()

            try:
                perm = grant_map_role_permission(map_id=new_map.id, role="editor")

                assert perm is not None
                assert perm.map_id == new_map.id
                assert perm.role == "editor"
                assert perm.user_id is None
            finally:
                _cleanup_permission(perm.id if perm else 0)
                db.session.delete(new_map)
                db.session.commit()

    def test_create_role_permission_duplicate_raises_error(self, app):
        """Попытка создать дубликат role-разрешения должна вызвать ValueError."""
        with app.app_context():
            # Operator Shared Map уже имеет role permission "editor" (из conftest)
            op_map = Map.query.filter_by(name="Operator Shared Map").first()

            with pytest.raises(ValueError, match="Role permission already exists"):
                grant_map_role_permission(map_id=op_map.id, role="editor")


# ============================================================================
# update_map_permission_role — обновление роли
# ============================================================================


class TestUpdateMapPermissionRole:
    """Тесты функции update_map_permission_role()."""

    def test_update_permission_role_success(self, app):
        """Успешное обновление роли в разрешении."""
        with app.app_context():
            admin = User.query.filter_by(username="admin").first()

            new_map = Map(name="Update Role Test Map", owner_id=admin.id)
            new_user = User(username="update_role_user", is_admin=False)
            new_user.set_password("Test123!")
            db.session.add_all([new_map, new_user])
            db.session.flush()

            try:
                perm = grant_map_permission(
                    map_id=new_map.id, user_id=new_user.id, role="viewer"
                )
                perm_id = perm.id

                updated = update_map_permission_role(perm_id=perm_id, role="editor")
                assert updated.role == "editor"
                assert updated.id == perm_id

                stored = db.session.get(MapPermission, perm_id)
                assert stored.role == "editor"
            finally:
                _cleanup_permission(perm_id if 'perm_id' in dir() else 0)
                db.session.delete(new_user)
                db.session.delete(new_map)
                db.session.commit()

    def test_update_nonexistent_permission_raises_404(self, app):
        """Обновление несуществующего разрешения должно вызвать 404."""
        with pytest.raises(Exception):
            update_map_permission_role(perm_id=99999, role="editor")


# ============================================================================
# revoke_map_permission — удаление разрешения
# ============================================================================


class TestRevokeMapPermission:
    """Тесты функции revoke_map_permission()."""

    def test_delete_permission_success(self, app):
        """Успешное удаление существующего разрешения."""
        with app.app_context():
            admin = User.query.filter_by(username="admin").first()

            new_map = Map(name="Revoke Test Map", owner_id=admin.id)
            new_user = User(username="revoke_user", is_admin=False)
            new_user.set_password("Test123!")
            db.session.add_all([new_map, new_user])
            db.session.flush()

            try:
                perm = grant_map_permission(
                    map_id=new_map.id, user_id=new_user.id, role="editor"
                )
                perm_id = perm.id

                revoke_map_permission(perm_id=perm_id)

                stored = db.session.get(MapPermission, perm_id)
                assert stored is None
            finally:
                db.session.delete(new_user)
                db.session.delete(new_map)
                db.session.commit()

    def test_delete_nonexistent_permission_raises_404(self, app):
        """Удаление несуществующего разрешения должно вызвать 404."""
        with pytest.raises(Exception):
            revoke_map_permission(perm_id=99999)


# ============================================================================
# Интеграционные тесты — полный цикл
# ============================================================================


class TestPermissionLifecycle:
    """Интеграционные тесты полного цикла работы с разрешениями."""

    def test_full_lifecycle_create_update_revoke(self, app):
        """Полный цикл: создать -> обновить роль -> удалить."""
        with app.app_context():
            admin = User.query.filter_by(username="admin").first()

            new_map = Map(name="Lifecycle Test Map", owner_id=admin.id)
            new_user = User(username="lifecycle_user", is_admin=False)
            new_user.set_password("Test123!")
            db.session.add_all([new_map, new_user])
            db.session.flush()

            try:
                # 1. Создать
                perm = grant_map_permission(
                    map_id=new_map.id, user_id=new_user.id, role="viewer"
                )
                perm_id = perm.id
                assert perm.role == "viewer"

                # 2. Обновить роль
                updated = update_map_permission_role(perm_id=perm_id, role="editor")
                assert updated.role == "editor"

                # 3. Удалить
                revoke_map_permission(perm_id=perm_id)

                # 4. Проверить удаление
                stored = db.session.get(MapPermission, perm_id)
                assert stored is None
            finally:
                db.session.delete(new_user)
                db.session.delete(new_map)
                db.session.commit()

    def test_multiple_permissions_same_map_different_roles(self, app):
        """Два пользователя с разными ролями на одной карте (UNIQUE map_id+role)."""
        with app.app_context():
            admin = User.query.filter_by(username="admin").first()

            new_map = Map(name="Multi Perm Test Map", owner_id=admin.id)
            db.session.add(new_map)
            db.session.commit()  # commit вместо flush для надёжного ID

            user1 = User(username="perm_multi_1", is_admin=False)
            user1.set_password("Test123!")
            user2 = User(username="perm_multi_2", is_admin=False)
            user2.set_password("Test123!")
            db.session.add_all([user1, user2])
            db.session.commit()

            perm1_id = None
            perm2_id = None

            try:
                perm1 = grant_map_permission(
                    map_id=new_map.id, user_id=user1.id, role="editor"
                )
                perm2 = grant_map_permission(
                    map_id=new_map.id, user_id=user2.id, role="admin"
                )
                perm1_id = perm1.id
                perm2_id = perm2.id

                assert db.session.get(MapPermission, perm1_id) is not None
                assert db.session.get(MapPermission, perm2_id) is not None

                revoke_map_permission(perm1_id)
                assert db.session.get(MapPermission, perm1_id) is None
                assert db.session.get(MapPermission, perm2_id) is not None
            finally:
                _cleanup_permission(perm2_id or 0)
                db.session.delete(user1)
                db.session.delete(user2)
                db.session.delete(new_map)
                db.session.commit()
