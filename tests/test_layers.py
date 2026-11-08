from models import Map, Device, DeviceType, Link, MapLayer, UserMapSettings, db


def login(client):
    return client.post('/auth/login', data={'username': 'testuser', 'password': 'User123!'})


def own_map_id(app):
    with app.app_context():
        return Map.query.filter_by(name='Own Map').first().id


def test_layer_crud_assignments_and_personal_visibility(app, client):
    login(client)
    map_id = own_map_id(app)
    created = client.post(f'/api/map/{map_id}/layers', json={'name': 'Core', 'description': 'critical path'})
    assert created.status_code == 201
    layer_id = created.get_json()['id']
    with app.app_context():
        dtype = DeviceType.query.first()
        a = Device(map_id=map_id, type_id=dtype.id, name='a')
        b = Device(map_id=map_id, type_id=dtype.id, name='b')
        db.session.add_all([a, b]); db.session.flush()
        link = Link(map_id=map_id, source_device_id=a.id, target_device_id=b.id)
        db.session.add(link); db.session.commit()
        device_id, link_id = a.id, link.id
    response = client.put(f'/api/map/{map_id}/layers/assignments', json={'layer_ids': [layer_id], 'device_ids': [device_id], 'link_ids': [link_id]})
    assert response.status_code == 200
    listed = client.get(f'/api/map/{map_id}/layers').get_json()['layers']
    assert listed[0]['device_ids'] == [device_id]
    assert listed[0]['link_ids'] == [link_id]
    visibility = client.put(f'/api/map/{map_id}/layer-visibility', json={'visible_layer_ids': []})
    assert visibility.status_code == 200
    assert visibility.get_json()['visible_layer_ids'] == []
    assert client.delete(f'/api/map/{map_id}/layers/{layer_id}').status_code == 200
    with app.app_context():
        assert db.session.get(MapLayer, layer_id) is None
        assert db.session.get(Device, device_id) is not None
        assert db.session.get(Link, link_id) is not None
        assert UserMapSettings.query.filter_by(map_id=map_id).first().visible_layer_ids == []


def test_locked_map_rejects_layer_mutation(app, client):
    login(client)
    with app.app_context():
        locked_id = Map.query.filter_by(name='Locked Map').first().id
    response = client.post(f'/api/map/{locked_id}/layers', json={'name': 'Denied'})
    assert response.status_code == 403


def test_layer_rejects_foreign_members_and_invalid_json(app, client):
    login(client)
    map_id = own_map_id(app)
    layer_id = client.post(f'/api/map/{map_id}/layers', json={'name': 'Local'}).get_json()['id']
    with app.app_context():
        foreign = Map.query.filter_by(name='Foreign Map').first()
        device = Device(map_id=foreign.id, name='Foreign')
        db.session.add(device)
        db.session.commit()
        device_id = device.id
    assert client.put(f'/api/map/{map_id}/layers/assignments', json={
        'layer_ids': [layer_id], 'device_ids': [device_id]
    }).status_code == 400
    assert client.post(f'/api/map/{map_id}/layers', json=['invalid']).status_code == 400
