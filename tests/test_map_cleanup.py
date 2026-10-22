"""Проверки полного удаления карты и зависимых сущностей."""

from models import (
    Device,
    DeviceHistory,
    DeviceIP,
    DeviceQualityHistory,
    Group,
    Link,
    Map,
    MapPermission,
    MapShape,
    UserMapSettings,
)
from services.map_service import delete_map_and_cleanup
from extensions import db


def test_delete_map_removes_all_owned_elements(app, map_ids):
    with app.app_context():
        map_obj = db.session.get(Map, map_ids["Own Map"])
        # Создаём отдельные сущности на карте, не затрагивая базовые фикстуры.
        parent = Group(name="Cleanup parent", map_id=map_obj.id)
        db.session.add(parent)
        db.session.flush()
        child = Group(
            name="Cleanup child", map_id=map_obj.id, parent_group_id=parent.id
        )
        db.session.add(child)
        db.session.flush()

        device1 = Device(
            map_id=map_obj.id, name="Cleanup 1", group_id=child.id, status="up"
        )
        device2 = Device(map_id=map_obj.id, name="Cleanup 2", status="up")
        db.session.add_all([device1, device2])
        db.session.flush()
        db.session.add(DeviceIP(device_id=device1.id, ip_address="192.0.2.10"))
        db.session.add(
            DeviceHistory(device_id=device1.id, old_status="up", new_status="down")
        )
        db.session.add(
            DeviceQualityHistory(
                device_id=device1.id, samples=8, loss_percent=0, quality="good"
            )
        )
        link = Link(
            map_id=map_obj.id,
            source_device_id=device1.id,
            target_device_id=device2.id,
        )
        shape = MapShape(
            map_id=map_obj.id,
            shape_type="rectangle",
            x=0,
            y=0,
            width=10,
            height=10,
        )
        db.session.add_all([link, shape])
        perm = MapPermission(map_id=map_obj.id, user_id=2, role="viewer")
        settings = UserMapSettings(user_id=2, map_id=map_obj.id)
        db.session.add_all([perm, settings])
        db.session.commit()

        map_id = map_obj.id
        device_ids = [device1.id, device2.id]
        group_ids = [parent.id, child.id]
        link_id, shape_id, perm_id = link.id, shape.id, perm.id

        delete_map_and_cleanup(map_id, app)

        assert db.session.get(Map, map_id) is None
        assert Device.query.filter(Device.id.in_(device_ids)).count() == 0
        assert DeviceIP.query.filter(DeviceIP.device_id.in_(device_ids)).count() == 0
        assert (
            DeviceHistory.query.filter(DeviceHistory.device_id.in_(device_ids)).count()
            == 0
        )
        assert (
            DeviceQualityHistory.query.filter(
                DeviceQualityHistory.device_id.in_(device_ids)
            ).count()
            == 0
        )
        assert Group.query.filter(Group.id.in_(group_ids)).count() == 0
        assert db.session.get(Link, link_id) is None
        assert db.session.get(MapShape, shape_id) is None
        assert db.session.get(MapPermission, perm_id) is None
        assert UserMapSettings.query.filter_by(map_id=map_id).count() == 0
