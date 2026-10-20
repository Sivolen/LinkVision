"""Проверки удаления папок вместе с их разрешениями."""

from extensions import db
from models import FolderPermission, MapFolder
from services.folder_service import create_folder, delete_folder


def test_delete_folder_removes_folder_permissions(app):
    with app.app_context():
        folder = create_folder("Permission folder", owner_id=1)
        perm = FolderPermission(folder_id=folder.id, user_id=2, role="viewer")
        db.session.add(perm)
        db.session.commit()
        folder_id, perm_id = folder.id, perm.id

        delete_folder(folder_id)

        assert db.session.get(MapFolder, folder_id) is None
        assert db.session.get(FolderPermission, perm_id) is None
