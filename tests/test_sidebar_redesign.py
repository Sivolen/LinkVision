"""Regression checks for the sidebar layout and existing permission gates."""


def test_admin_sidebar_keeps_actions_routes_and_active_admin_page(client, login):
    login("admin")
    response = client.get("/admin/users")
    assert response.status_code == 200
    html = response.get_data(as_text=True)

    assert 'class="sidebar-map-actions"' in html
    assert 'data-bs-target="#createMapModal"' in html
    assert "onclick=\"importMapNew()\"" in html
    assert "onclick=\"createFolderPrompt(null)\"" in html
    assert 'href="/admin/users"' in html
    assert 'aria-current="page"' in html
    assert 'aria-label="Переключить боковую панель"' in html
    assert 'action="/auth/logout"' in html
    assert 'action="/set-language/en"' in html


def test_regular_user_sees_only_allowed_sidebar_actions(client, login, map_ids):
    login("testuser")
    response = client.get(f"/map/{map_ids['Own Map']}")
    assert response.status_code == 200
    html = response.get_data(as_text=True)

    assert "sidebar-map-actions" not in html
    assert "admin-menu" not in html
    assert f"window.currentMapId = {map_ids['Own Map']};" in html
