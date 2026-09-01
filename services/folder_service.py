"""
Сервис для работы с папками карт (MapFolder) и правами на них
(FolderPermission).

Папка — это чисто навигационная сущность сайдбара (дерево карт), поэтому
операции над папками НИКОГДА не удаляют и не трогают сами карты: удаление
папки с картами внутри либо отклоняется (по умолчанию), либо переносит
карты в корень (cascade=True), но не удаляет их.
"""

from typing import Optional

from models import Map, MapFolder, FolderPermission, db
from services.map_service import invalidate_all_sidebar_caches
from utils.logger import api_logger


def _is_descendant(folder_id: int, maybe_ancestor_id: int) -> bool:
    """
    True, если folder_id лежит внутри поддерева maybe_ancestor_id (или
    совпадает с ним). Используется, чтобы не дать зациклить дерево при
    перемещении папки внутрь собственного потомка.
    """
    current = db.session.get(MapFolder, folder_id)
    seen = set()
    while current and current.id not in seen:
        if current.id == maybe_ancestor_id:
            return True
        seen.add(current.id)
        current = (
            db.session.get(MapFolder, current.parent_id) if current.parent_id else None
        )
    return False


def create_folder(
    name: str, owner_id: int, parent_id: Optional[int] = None
) -> MapFolder:
    """Создать папку. parent_id=None — папка верхнего уровня."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Название папки не может быть пустым")

    if parent_id is not None and not db.session.get(MapFolder, parent_id):
        raise ValueError("Родительская папка не найдена")

    folder = MapFolder(name=name, owner_id=owner_id, parent_id=parent_id)
    db.session.add(folder)
    db.session.commit()
    invalidate_all_sidebar_caches()
    api_logger.info(f"Folder created: id={folder.id}, name={name}, owner={owner_id}")
    return folder


def rename_folder(folder_id: int, name: str) -> MapFolder:
    name = (name or "").strip()
    if not name:
        raise ValueError("Название папки не может быть пустым")

    folder = MapFolder.query.get_or_404(folder_id)
    folder.name = name
    db.session.commit()
    invalidate_all_sidebar_caches()
    return folder


def move_folder(folder_id: int, new_parent_id: Optional[int]) -> MapFolder:
    """
    Переместить папку под другого родителя (new_parent_id=None — в корень).

    Запрещено перемещать папку в саму себя или в одну из её же подпапок —
    иначе дерево зациклится и рекурсивный обход (сборка дерева сайдбара,
    подсчёт потомков для прав) уйдёт в бесконечный цикл.
    """
    folder = MapFolder.query.get_or_404(folder_id)

    if new_parent_id is not None:
        if new_parent_id == folder_id:
            raise ValueError("Папка не может быть родителем самой себе")
        if not db.session.get(MapFolder, new_parent_id):
            raise ValueError("Целевая папка не найдена")
        if _is_descendant(new_parent_id, folder_id):
            raise ValueError(
                "Нельзя переместить папку в одну из её собственных подпапок"
            )

    folder.parent_id = new_parent_id
    db.session.commit()
    invalidate_all_sidebar_caches()
    return folder


def delete_folder(folder_id: int, cascade: bool = False) -> None:
    """
    Удалить папку.

    Если в папке есть карты и/или подпапки:
    - cascade=False (по умолчанию) — отказ (ValueError), чтобы не потерять
      структуру сайдбара одним случайным кликом;
    - cascade=True — подпапки удаляются рекурсивно (тоже лишь как
      навигационные узлы), а карты внутри переносятся в корень
      (folder_id=None). Карты НЕ удаляются никогда.
    """
    folder = MapFolder.query.get_or_404(folder_id)
    has_maps = folder.maps.count() > 0
    has_children = len(folder.children) > 0

    if (has_maps or has_children) and not cascade:
        raise ValueError("Папка не пуста")

    if cascade:
        for child in list(folder.children):
            delete_folder(child.id, cascade=True)
        for m in folder.maps.all():
            m.folder_id = None

    db.session.delete(folder)
    db.session.commit()
    invalidate_all_sidebar_caches()
    api_logger.info(f"Folder deleted: id={folder_id}, cascade={cascade}")


def move_map_to_folder(map_id: int, folder_id: Optional[int]) -> Map:
    """Переместить карту в папку (folder_id=None — в корень сайдбара)."""
    map_obj = Map.query.get_or_404(map_id)
    if folder_id is not None and not db.session.get(MapFolder, folder_id):
        raise ValueError("Папка не найдена")
    map_obj.folder_id = folder_id
    db.session.commit()
    invalidate_all_sidebar_caches()
    return map_obj


def grant_folder_permission(
    folder_id: int, user_id: int, role: str
) -> FolderPermission:
    existing = FolderPermission.query.filter_by(
        folder_id=folder_id, user_id=user_id
    ).first()
    if existing:
        raise ValueError("Permission already exists for this user")

    perm = FolderPermission(folder_id=folder_id, user_id=user_id, role=role)
    db.session.add(perm)
    db.session.commit()
    invalidate_all_sidebar_caches()
    api_logger.info(
        f"Folder permission granted: folder_id={folder_id}, user_id={user_id}, role={role}"
    )
    return perm


def grant_folder_role_permission(folder_id: int, role: str) -> FolderPermission:
    existing = FolderPermission.query.filter_by(
        folder_id=folder_id, role=role, user_id=None
    ).first()
    if existing:
        raise ValueError("Role permission already exists")

    perm = FolderPermission(folder_id=folder_id, role=role)
    db.session.add(perm)
    db.session.commit()
    invalidate_all_sidebar_caches()
    api_logger.info(
        f"Folder role permission granted: folder_id={folder_id}, role={role}"
    )
    return perm


def update_folder_permission_role(perm_id: int, role: str) -> FolderPermission:
    perm = FolderPermission.query.get_or_404(perm_id)
    perm.role = role
    db.session.commit()
    invalidate_all_sidebar_caches()
    return perm


def revoke_folder_permission(perm_id: int) -> None:
    perm = FolderPermission.query.get_or_404(perm_id)
    db.session.delete(perm)
    db.session.commit()
    invalidate_all_sidebar_caches()
    api_logger.info(f"Folder permission revoked: perm_id={perm_id}")
