"""
Репозиторий для работы с картами.

Инкапсулирует все SQL-запросы к таблице Map.
"""

from typing import List, Optional
from extensions import db
from models import Map, MapPermission, MapFolder, FolderPermission


class MapRepository:
    """Репозиторий для работы с картами."""

    @staticmethod
    def get_by_id(map_id: int) -> Optional[Map]:
        """
        Получить карту по ID.

        Args:
            map_id: ID карты

        Returns:
            Optional[Map]: Карта или None
        """
        return db.session.get(Map, map_id)

    @staticmethod
    def get_all() -> List[Map]:
        """
        Получить все карты.

        Returns:
            List[Map]: Список всех карт
        """
        return Map.query.all()

    @staticmethod
    def get_by_owner(owner_id: int) -> List[Map]:
        """
        Получить карты владельца.

        Args:
            owner_id: ID владельца

        Returns:
            List[Map]: Список карт владельца
        """
        return Map.query.filter_by(owner_id=owner_id).all()

    @staticmethod
    def get_available_for_user(user) -> List[Map]:
        """
        Получить карты, доступные пользователю для просмотра.

        Логика:
        - Администратор видит все карты
        - Оператор видит ВСЕ карты (но редактировать может только с разрешением)
        - Обычный пользователь видит свои карты + карты с персональными разрешениями

        Args:
            user: Объект пользователя

        Returns:
            List[Map]: Список доступных карт
        """
        if user.is_admin:
            return Map.query.all()

        # Оператор видит ВСЕ карты
        if user.is_operator:
            return Map.query.all()

        # Карты пользователя
        user_maps = Map.query.filter_by(owner_id=user.id).all()
        user_map_ids = {m.id for m in user_maps}

        # Карты с персональными разрешениями
        perms = MapPermission.query.filter_by(user_id=user.id).all()
        perm_map_ids = {p.map_id for p in perms}

        # Карты, доступные через папку: разрешение на папку действует на все
        # карты внутри неё И во всех вложенных подпапках — поэтому набор ID
        # папок расширяем потомками, прежде чем искать карты.
        folder_perms = FolderPermission.query.filter_by(user_id=user.id).all()
        granted_folder_ids = {p.folder_id for p in folder_perms}
        folder_map_ids: set = set()
        if granted_folder_ids:
            all_folder_ids = MapRepository.expand_with_descendant_folders(granted_folder_ids)
            folder_map_ids = {
                m.id for m in Map.query.filter(Map.folder_id.in_(all_folder_ids)).all()
            }

        # Собираем все уникальные ID
        all_map_ids = user_map_ids.union(perm_map_ids).union(folder_map_ids)

        if not all_map_ids:
            return []

        return Map.query.filter(Map.id.in_(list(all_map_ids))).all()

    @staticmethod
    def expand_with_descendant_folders(folder_ids) -> set:
        """
        Дополнить множество ID папок ID-ами ВСЕХ их вложенных подпапок
        (рекурсивно, произвольная глубина дерева).

        Обход через ORM-relationship (children), а не рекурсивный SQL CTE —
        проще и переносимо между SQLite/Postgres, а глубина дерева папок на
        практике невелика (это сайдбар навигации, не миллион строк).
        """
        result = set(folder_ids)
        queue = list(folder_ids)
        while queue:
            fid = queue.pop()
            folder = db.session.get(MapFolder, fid)
            if not folder:
                continue
            for child in folder.children:
                if child.id not in result:
                    result.add(child.id)
                    queue.append(child.id)
        return result

    @staticmethod
    def create(name: str, owner_id: int, background_image: Optional[str] = None) -> Map:
        """
        Создать карту.

        Args:
            name: Название карты
            owner_id: ID владельца
            background_image: Имя файла фона

        Returns:
            Map: Созданная карта
        """
        map_obj = Map(name=name, owner_id=owner_id, background_image=background_image)
        db.session.add(map_obj)
        db.session.commit()
        return map_obj

    @staticmethod
    def update_details(
        map_id: int,
        name: Optional[str] = None,
        background_image: Optional[str] = None,
        remove_background: bool = False,
    ) -> Optional[Map]:
        """
        Обновить детали карты.

        Args:
            map_id: ID карты
            name: Новое название
            background_image: Имя файла фона
            remove_background: Удалить фон

        Returns:
            Optional[Map]: Обновленная карта или None
        """
        map_obj = db.session.get(Map, map_id)
        if not map_obj:
            return None

        if name is not None:
            map_obj.name = name

        if remove_background:
            map_obj.background_image = None
        elif background_image is not None:
            map_obj.background_image = background_image

        db.session.commit()
        return map_obj

    @staticmethod
    def delete(map_id: int) -> bool:
        """
        Удалить карту.

        Args:
            map_id: ID карты

        Returns:
            bool: True если удалено
        """
        map_obj = db.session.get(Map, map_id)
        if not map_obj:
            return False

        db.session.delete(map_obj)
        db.session.commit()
        return True

    @staticmethod
    def exists(map_id: int) -> bool:
        """
        Проверить существование карты.

        Args:
            map_id: ID карты

        Returns:
            bool: True если карта существует
        """
        return db.session.get(Map, map_id) is not None


# Singleton instance
map_repo = MapRepository()
