from html import unescape
from urllib.parse import parse_qs, urlsplit

from models import Device, MapShape, db
from services.map_import_export_service import export_map_data


def portal_data(source, target):
    return {
        "map_id": source,
        "target_map_id": target,
        "shape_type": "map_link",
        "description": "  Branch office  ",
        "x": 10,
        "y": 15,
        "width": 140,
        "height": 48,
    }


def test_follow_and_return_to_original_view(client, login, map_ids, emit_recorder):
    login("testuser")
    source, destination = map_ids["Own Map"], map_ids["Shared Viewer Map"]
    response = client.post("/api/shape", json=portal_data(source, destination))
    assert response.status_code == 201
    portal_id = response.json["id"]
    event = next(event for event in emit_recorder if event["event"] == "shape_created")
    assert event["payload"]["shape"]["target_map_id"] == destination

    response = client.get(f"/map/portal/{portal_id}?pan_x=-38.5&pan_y=47&zoom=1.6")
    assert response.status_code == 302
    forward = urlsplit(response.location)
    assert forward.path == f"/map/{destination}"
    assert parse_qs(forward.query)["via"] == [str(portal_id)]
    destination_page = unescape(client.get(response.location).text)
    assert f"/map/{source}?resume=1&pan_x=-38.5&pan_y=47.0&zoom=1.6" in destination_page

    restored = client.get(f"/map/{source}?resume=1&pan_x=-38.5&pan_y=47&zoom=1.6")
    assert restored.status_code == 200
    assert 'data-restore-exact-view="true"' in restored.text
    assert 'data-pan-x="-38.5"' in restored.text
    assert 'data-zoom="1.6"' in restored.text
    invalid = client.get(f"/map/{source}?resume=1&pan_x=nan&pan_y=0&zoom=12")
    assert 'data-restore-exact-view="false"' in invalid.text


def test_portal_authorizes_creation_and_each_navigation(client, login, map_ids):
    source, forbidden = map_ids["Own Map"], map_ids["Foreign Map"]
    login("testuser")
    assert client.post("/api/shape", json=portal_data(source, source)).status_code == 400
    assert client.post("/api/shape", json=portal_data(source, forbidden)).status_code == 403
    assert client.post("/api/shape", json=portal_data(map_ids["Shared Viewer Map"], source)).status_code == 403
    login("admin")
    # Source and destination permission checks are independent of shape visibility.
    portal_id = client.post("/api/shape", json=portal_data(source, forbidden)).json["id"]
    reverse_id = client.post("/api/shape", json=portal_data(forbidden, source)).json["id"]
    login("testuser")
    assert client.get(f"/map/portal/{portal_id}").status_code == 403
    assert client.get(f"/map/portal/{reverse_id}").status_code == 403
    assert 'resume=1' not in client.get(f"/map/{source}?via={reverse_id}").text


def test_portal_position_and_destination_lifecycle(client, login, map_ids, app):
    source, destination = map_ids["Own Map"], map_ids["Shared Viewer Map"]
    login("admin")
    portal_id = client.post("/api/shape", json=portal_data(source, destination)).json["id"]
    assert client.put(f"/api/shape/{portal_id}", json={"x": 80}).status_code == 200
    assert client.put(f"/api/shape/{portal_id}", json={"description": ""}).status_code == 400
    elements_url = f"/api/map/{source}/elements"
    before = next(shape for shape in client.get(elements_url).json["shapes"] if shape["id"] == portal_id)
    assert before["target_map_id"] == destination
    assert before["description"] == "Branch office"
    with app.app_context():
        exported = next(shape for shape in export_map_data(source)["shapes"] if shape["id"] == portal_id)
        assert exported["shape_type"] == "rectangle"
        assert "target_map_id" not in exported
        from services.map_service import delete_map_and_cleanup
        delete_map_and_cleanup(destination, app)
        assert db.session.get(MapShape, portal_id).target_map_id is None
    assert client.get(f"/map/portal/{portal_id}").status_code == 404
    after = next(shape for shape in client.get(elements_url).json["shapes"] if shape["id"] == portal_id)
    assert after["target_map_id"] is None
    assert client.delete(f"/api/shape/{portal_id}").status_code == 200



def test_portal_marker_can_change_shape_without_changing_destination(client, login, map_ids, emit_recorder):
    login("testuser")
    source, destination = map_ids["Own Map"], map_ids["Shared Viewer Map"]
    response = client.post("/api/shape", json={
        **portal_data(source, destination), "portal_shape": "circle", "width": 96, "height": 96,
    })
    assert response.status_code == 201
    portal_id = response.json["id"]
    endpoint = f"/api/shape/{portal_id}"
    assert client.put(endpoint, json={"portal_shape": "other"}).status_code == 400
    assert client.put(endpoint, json={"portal_shape": "square", "width": 90, "height": 90}).status_code == 200
    events = [event for event in emit_recorder if event["event"] in ("shape_created", "shape_updated")]
    assert [event["payload"]["shape"]["portal_shape"] for event in events] == ["circle", "square"]
    assert all(event["payload"]["shape"]["target_map_id"] == destination for event in events)
    shapes = client.get(f"/api/map/{source}/elements").json["shapes"]
    marker = next(shape for shape in shapes if shape["id"] == portal_id)
    assert (marker["portal_shape"], marker["width"], marker["height"]) == ("square", 90, 90)
    assert urlsplit(client.get(f"/map/portal/{portal_id}").location).path == f"/map/{destination}"



def test_portal_statuses_follow_current_monitoring_and_permissions(client, login, map_ids, app):
    source, destination, forbidden = (map_ids[key] for key in (
        "Own Map", "Shared Viewer Map", "Foreign Map",
    ))
    login("admin")
    for target in (destination, destination, forbidden):
        assert client.post("/api/shape", json=portal_data(source, target)).status_code == 201

    with app.app_context():
        failing = Device(map_id=destination, name="Monitored", status="down", acknowledged=True)
        db.session.add_all([
            failing,
            Device(map_id=destination, name="Monitoring disabled", status="down", monitoring_enabled=False),
            Device(map_id=destination, name="Partially reachable", status="partial"),
            Device(map_id=forbidden, name="Private outage", status="down"),
        ])
        db.session.commit()
        failing_id = failing.id

    endpoint = f"/api/map/{source}/portal-statuses"
    assert client.get(endpoint).json == {"statuses": {str(destination): "down", str(forbidden): "down"}}

    login("testuser")
    response = client.get(endpoint)
    assert response.json == {"statuses": {str(destination): "down"}}
    assert response.cache_control.no_store
    assert client.get(f"/api/map/{forbidden}/portal-statuses").status_code == 403

    with app.app_context():
        db.session.get(Device, failing_id).status = "up"
        db.session.commit()
    assert client.get(endpoint).json == {"statuses": {str(destination): "clear"}}
    assert client.get(f"/api/map/{destination}/portal-statuses").json == {"statuses": {}}
