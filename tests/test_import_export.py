"""
Тесты для map_import_export_service.py (Импорт/экспорт карт).

Проверяют:
- Экспорт карты в JSON-структуру
- Импорт валидных данных
- Валидацию импортируемых данных
- Дедупликацию IP при импорте

Тесты используют фикстуры из tests/conftest.py.
"""

import pytest
from models import Map, Device, Link, Group, DeviceType, DeviceIP, User
from extensions import db
from services.map_import_export_service import (
    export_map_data,
    import_map,
)


# ============================================================================
# Фикстуры
# ============================================================================


@pytest.fixture
def sample_map_with_devices(app):
    """Создать карту с устройствами, связями и группами для экспорта."""
    with app.app_context():
        # Создать тип устройства
        dtype = DeviceType(name="Router", width=32, height=32, icon_filename="router.png")
        db.session.add(dtype)
        db.session.flush()

        # Создать карту
        map_obj = Map(name="Export Test Map", owner_id=1, background_image="bg.png")
        db.session.add(map_obj)
        db.session.flush()

        # Создать группу
        group = Group(name="Test Group", color="#FF0000", map_id=map_obj.id)
        db.session.add(group)
        db.session.flush()
        group_id = group.id

        # Создать устройство
        dev1 = Device(
            map_id=map_obj.id,
            type_id=dtype.id,
            name="Router 1",
            pos_x=100,
            pos_y=100,
            status="up",
            group_id=group_id,
        )
        db.session.add(dev1)
        db.session.flush()

        # Добавить IP
        ip1 = DeviceIP(device_id=dev1.id, ip_address="192.168.1.1")
        ip2 = DeviceIP(device_id=dev1.id, ip_address="192.168.1.2")
        db.session.add_all([ip1, ip2])

        # Создать второе устройство
        dev2 = Device(
            map_id=map_obj.id,
            type_id=dtype.id,
            name="Switch 1",
            pos_x=200,
            pos_y=200,
            status="down",
        )
        db.session.add(dev2)
        db.session.flush()

        # Создать связь
        link = Link(
            map_id=map_obj.id,
            source_device_id=dev1.id,
            target_device_id=dev2.id,
            source_interface="eth0",
            target_interface="eth1",
            link_type="10G",
            line_color="#FF5733",
            line_width=4,
            line_style="dashed",
        )
        db.session.add(link)
        db.session.commit()

        yield {
            "map": map_obj,
            "device1": dev1,
            "device2": dev2,
            "group": group,
            "link": link,
            "dtype": dtype,
        }

        # Очистка
        db.session.delete(link)
        db.session.delete(dev1)
        db.session.delete(dev2)
        db.session.delete(group)
        db.session.delete(map_obj)
        db.session.delete(dtype)
        db.session.commit()


# ============================================================================
# Экспорт карты
# ============================================================================


class TestExportMapData:
    """Тесты функции export_map_data()."""

    def test_export_map_data_success(self, app, sample_map_with_devices):
        """Экспорт карты должен вернуть корректную JSON-структуру."""
        with app.app_context():
            map_id = sample_map_with_devices["map"].id
            data = export_map_data(map_id)

            # Проверить основные поля
            assert data["id"] == map_id
            assert data["name"] == "Export Test Map"
            assert data["background_image"] == "bg.png"
            assert "devices" in data
            assert "links" in data
            assert "groups" in data

            # Проверить устройства
            assert len(data["devices"]) == 2
            dev1_data = next(d for d in data["devices"] if d["name"] == "Router 1")
            assert dev1_data["pos_x"] == 100
            assert dev1_data["pos_y"] == 100
            assert dev1_data["status"] == "up"
            assert dev1_data["group_id"] == sample_map_with_devices["group"].id
            assert len(dev1_data["ips"]) == 2
            assert "192.168.1.1" in dev1_data["ips"]
            assert "192.168.1.2" in dev1_data["ips"]

            # Проверить связи
            assert len(data["links"]) == 1
            link_data = data["links"][0]
            assert link_data["source_interface"] == "eth0"
            assert link_data["target_interface"] == "eth1"
            assert link_data["link_type"] == "10G"
            assert link_data["line_color"] == "#FF5733"
            assert link_data["line_width"] == 4
            assert link_data["line_style"] == "dashed"

            # Проверить группы
            assert len(data["groups"]) == 1
            assert data["groups"][0]["name"] == "Test Group"
            assert data["groups"][0]["color"] == "#FF0000"

    def test_export_nonexistent_map_raises_404(self, app):
        """Экспорт несуществующей карты должен вызвать 404."""
        with pytest.raises(Exception):  # get_or_404抛出404
            export_map_data(map_id=99999)

    def test_export_empty_map(self, app):
        """Экспорт карты без устройств должен вернуть пустые списки."""
        with app.app_context():
            map_obj = Map(name="Empty Map", owner_id=1)
            db.session.add(map_obj)
            db.session.flush()
            map_id = map_obj.id

            try:
                data = export_map_data(map_id)
                assert data["id"] == map_id
                assert data["name"] == "Empty Map"
                assert data["devices"] == []
                assert data["links"] == []
                assert data["groups"] == []
            finally:
                db.session.delete(map_obj)
                db.session.commit()


# ============================================================================
# Импорт карты
# ============================================================================


class TestImportMap:
    """Тесты функции import_map()."""

    def test_import_map_success(self, app, sample_map_with_devices):
        """Успешный импорт карты с устройствами и связями."""
        with app.app_context():
            # Экспортируем существующую карту
            old_map_id = sample_map_with_devices["map"].id
            exported_data = export_map_data(old_map_id)

            # Импортируем с новым именем
            exported_data["name"] = "Imported Map"
            exported_data.pop("id")  # Убираем id для создания новой карты

            mock_user = type("MockUser", (), {"id": 1})()
            imported_map = import_map(exported_data, mock_user)

            assert imported_map is not None
            assert imported_map.name == "Imported Map"
            assert imported_map.owner_id == 1

            # Проверить устройства
            devices = Device.query.filter_by(map_id=imported_map.id).all()
            assert len(devices) == 2

            # Проверить связи
            links = Link.query.filter_by(map_id=imported_map.id).all()
            assert len(links) == 1

            # Проверить группы
            groups = Group.query.filter_by(map_id=imported_map.id).all()
            assert len(groups) == 1

    def test_import_map_with_new_name_creates_new(self, app):
        """Импорт без id должен создать новую карту."""
        with app.app_context():
            data = {
                "name": "New Imported Map",
                "devices": [
                    {
                        "id": "dev1",
                        "name": "Test Device",
                        "type_name": "Router",
                        "ips": ["192.168.1.1"],
                        "pos_x": 100,
                        "pos_y": 100,
                    }
                ],
                "links": [],
                "groups": [],
            }

            mock_user = type("MockUser", (), {"id": 1})()
            imported_map = import_map(data, mock_user)

            assert imported_map.name == "New Imported Map"
            assert imported_map.owner_id == 1

            devices = Device.query.filter_by(map_id=imported_map.id).all()
            assert len(devices) == 1
            assert devices[0].name == "Test Device"

    def test_import_map_invalid_json_missing_required_fields(self, app):
        """Импорт с битым JSON должен вызвать ошибку."""
        with app.app_context():
            # Нет обязательного поля name
            data = {
                "devices": [
                    {"id": "dev1", "type_name": "Router"}  # нет "name"
                ],
                "links": [],
                "groups": [],
            }

            mock_user = type("MockUser", (), {"id": 1})()
            
            # Должна быть ошибка KeyError при отсутствии name
            with pytest.raises((KeyError, ValueError)):
                import_map(data, mock_user)

    def test_import_map_duplicate_names(self, app):
        """Импорт карты с существующим именем должен создать новую карту."""
        with app.app_context():
            # Создать карту с именем "Test Map"
            existing_map = Map(name="Test Map", owner_id=1)
            db.session.add(existing_map)
            db.session.flush()

            try:
                data = {
                    "name": "Test Map",  # То же имя
                    "devices": [],
                    "links": [],
                    "groups": [],
                }

                mock_user = type("MockUser", (), {"id": 1})()
                imported_map = import_map(data, mock_user)

                # Должна создаться новая карта (имя не уникально)
                assert imported_map is not None
                assert imported_map.name == "Test Map"

                # Проверить, что существует минимум 2 карты с этим именем
                maps = Map.query.filter_by(name="Test Map").all()
                assert len(maps) >= 2
            finally:
                db.session.delete(existing_map)
                db.session.commit()

    def test_import_map_ip_deduplication(self, app):
        """Импорт должен дедублировать IP-адреса."""
        with app.app_context():
            data = {
                "name": "Dedup Test Map",
                "devices": [
                    {
                        "id": "dev1",
                        "name": "Test Device",
                        "type_name": "Router",
                        "ips": ["192.168.1.1", "192.168.1.1", "192.168.1.1"],  # дубликаты
                        "pos_x": 100,
                        "pos_y": 100,
                    }
                ],
                "links": [],
                "groups": [],
            }

            mock_user = type("MockUser", (), {"id": 1})()
            imported_map = import_map(data, mock_user)

            # Проверить дедупликацию
            devices = Device.query.filter_by(map_id=imported_map.id).all()
            assert len(devices) == 1

            ips = DeviceIP.query.filter_by(device_id=devices[0].id).all()
            assert len(ips) == 1  # Только один IP, несмотря на 3 в данных
            assert ips[0].ip_address == "192.168.1.1"

    def test_import_map_skips_invalid_links(self, app):
        """Импорт должен пропускать связи с несуществующими устройствами."""
        with app.app_context():
            data = {
                "name": "Invalid Link Map",
                "devices": [
                    {
                        "id": "dev1",
                        "name": "Test Device",
                        "type_name": "Router",
                        "ips": ["192.168.1.1"],
                        "pos_x": 100,
                        "pos_y": 100,
                    }
                ],
                "links": [
                    {
                        "source_device_id": "dev1",
                        "target_device_id": "nonexistent",  # такого device нет
                        "source_interface": "eth0",
                        "target_interface": "eth1",
                    }
                ],
                "groups": [],
            }

            mock_user = type("MockUser", (), {"id": 1})()
            imported_map = import_map(data, mock_user)

            # Связь должна быть пропущена (не создана)
            links = Link.query.filter_by(map_id=imported_map.id).all()
            assert len(links) == 0

    def test_import_map_updates_existing(self, app, sample_map_with_devices):
        """Импорт с id должен обновить существующую карту."""
        with app.app_context():
            old_map_id = sample_map_with_devices["map"].id

            # Экспортируем
            exported_data = export_map_data(old_map_id)

            # Изменим имя
            exported_data["name"] = "Updated Map"

            # Нужен request context, т.к. _check_map_edit_permission() ->
            # can_edit_map() опирается на current_user от Flask-Login
            with app.test_request_context():
                from flask_login import login_user

                admin = User.query.filter_by(username="admin").first()
                login_user(admin)
                imported_map = import_map(exported_data, admin)

            # Карта должна обновиться (не создана новая)
            assert imported_map.id == old_map_id
            assert imported_map.name == "Updated Map"


# ============================================================================
# Интеграционные тесты — полный цикл
# ============================================================================


class TestImportExportLifecycle:
    """Интеграционные тесты полного цикла импорт/экспорт."""

    def test_roundtrip_export_import(self, app, sample_map_with_devices):
        """Экспорт -> импорт -> проверка целостности данных."""
        with app.app_context():
            # Экспорт
            old_map_id = sample_map_with_devices["map"].id
            exported_data = export_map_data(old_map_id)

            # Импорт с новым именем
            exported_data["name"] = "Roundtrip Map"
            exported_data.pop("id")

            mock_user = type("MockUser", (), {"id": 1})()
            imported_map = import_map(exported_data, mock_user)

            # Экспортируем снова
            reexported_data = export_map_data(imported_map.id)

            # Проверить, что основные поля совпадают
            assert reexported_data["name"] == "Roundtrip Map"
            assert len(reexported_data["devices"]) == len(exported_data["devices"])
            assert len(reexported_data["links"]) == len(exported_data["links"])
            assert len(reexported_data["groups"]) == len(exported_data["groups"])
