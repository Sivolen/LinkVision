"""
Регресс-тесты вложенных групп (parent_group_id).

Покрывают серверный контракт, на который опирается UI сворачивания и модалка
групп: подгруппы создаются и отдаются с родителем, дерево не может замкнуться
в цикл, а список групп карты пригоден для построения иерархии.
"""

import pytest

from models import Group, db
from services import group_service


@pytest.fixture
def own_map_id(app, map_ids):
    return map_ids["Own Map"]


def _create_group(client, map_id, name, parent_group_id=None):
    payload = {"map_id": map_id, "name": name}
    if parent_group_id is not None:
        payload["parent_group_id"] = parent_group_id
    return client.post("/api/group", json=payload)


class TestCreateNestedGroups:
    def test_create_subgroup_sets_parent(self, client, login, own_map_id, app):
        login("testuser")

        parent = _create_group(client, own_map_id, "Родитель")
        assert parent.status_code == 201
        parent_id = parent.get_json()["id"]

        child = _create_group(client, own_map_id, "Дочерняя", parent_group_id=parent_id)
        assert child.status_code == 201
        child_id = child.get_json()["id"]

        with app.app_context():
            assert db.session.get(Group, child_id).parent_group_id == parent_id
            assert db.session.get(Group, parent_id).parent_group_id is None

    def test_group_without_parent_is_root(self, client, login, own_map_id, app):
        login("testuser")
        resp = _create_group(client, own_map_id, "Корневая")
        assert resp.status_code == 201

        with app.app_context():
            assert db.session.get(Group, resp.get_json()["id"]).parent_group_id is None

    def test_parent_from_another_map_rejected(self, client, login, map_ids, app):
        """Родитель обязан принадлежать той же карте, иначе дерево карты рвётся."""
        login("admin")
        foreign = _create_group(client, map_ids["Foreign Map"], "Чужая")
        assert foreign.status_code == 201
        foreign_id = foreign.get_json()["id"]

        resp = _create_group(client, map_ids["Own Map"], "Своя", parent_group_id=foreign_id)
        assert resp.status_code == 400


class TestGroupListForTree:
    def test_list_returns_parent_id_for_hierarchy(self, client, login, own_map_id):
        """Модалка строит дерево по parent_group_id — он должен быть в ответе."""
        login("testuser")
        parent_id = _create_group(client, own_map_id, "Родитель").get_json()["id"]
        child_id = _create_group(
            client, own_map_id, "Дочерняя", parent_group_id=parent_id
        ).get_json()["id"]

        resp = client.get(f"/api/map/{own_map_id}/groups")
        assert resp.status_code == 200
        groups = {g["id"]: g for g in resp.get_json()}

        assert child_id in groups and parent_id in groups
        assert "parent_group_id" in groups[child_id]
        assert groups[child_id]["parent_group_id"] == parent_id
        assert groups[parent_id]["parent_group_id"] is None


class TestCycleProtection:
    def test_group_cannot_be_its_own_parent(self, client, login, own_map_id):
        login("testuser")
        group_id = _create_group(client, own_map_id, "Сама себе").get_json()["id"]

        resp = client.put(f"/api/group/{group_id}", json={"parent_group_id": group_id})
        assert resp.status_code == 400

    def test_group_cannot_become_child_of_its_descendant(self, client, login, own_map_id, app):
        """A → B → C; попытка сделать A потомком C замкнула бы дерево в цикл."""
        login("testuser")
        a_id = _create_group(client, own_map_id, "A").get_json()["id"]
        b_id = _create_group(client, own_map_id, "B", parent_group_id=a_id).get_json()["id"]
        c_id = _create_group(client, own_map_id, "C", parent_group_id=b_id).get_json()["id"]

        resp = client.put(f"/api/group/{a_id}", json={"parent_group_id": c_id})
        assert resp.status_code == 400

        with app.app_context():
            assert db.session.get(Group, a_id).parent_group_id is None

    def test_would_create_cycle_detects_indirect_loop(self, app, own_map_id):
        with app.app_context():
            a = group_service.create_group(own_map_id, "A")
            b = group_service.create_group(own_map_id, "B", parent_group_id=a.id)
            c = group_service.create_group(own_map_id, "C", parent_group_id=b.id)

            assert group_service.would_create_cycle(a.id, c.id) is True
            # Группа сама себе родитель — тоже цикл (раньше возвращалось False).
            assert group_service.would_create_cycle(a.id, a.id) is True
            assert group_service.would_create_cycle(c.id, a.id) is False
            assert group_service.would_create_cycle(a.id, None) is False


class TestReparenting:
    def test_move_group_to_another_parent(self, client, login, own_map_id, app):
        login("testuser")
        first = _create_group(client, own_map_id, "Первый").get_json()["id"]
        second = _create_group(client, own_map_id, "Второй").get_json()["id"]
        child = _create_group(client, own_map_id, "Дочерняя", parent_group_id=first).get_json()["id"]

        resp = client.put(f"/api/group/{child}", json={"parent_group_id": second})
        assert resp.status_code == 200

        with app.app_context():
            assert db.session.get(Group, child).parent_group_id == second

    def test_detach_group_to_root(self, client, login, own_map_id, app):
        login("testuser")
        parent_id = _create_group(client, own_map_id, "Родитель").get_json()["id"]
        child_id = _create_group(client, own_map_id, "Дочерняя", parent_group_id=parent_id).get_json()["id"]

        resp = client.put(f"/api/group/{child_id}", json={"parent_group_id": None})
        assert resp.status_code == 200

        with app.app_context():
            assert db.session.get(Group, child_id).parent_group_id is None
