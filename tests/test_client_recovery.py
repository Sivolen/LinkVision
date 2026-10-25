"""Regression tests for persistent Socket.IO reconnects and frontend updates."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_app_version_endpoint_requires_authentication(client):
    response = client.get("/api/app-version", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["Location"].startswith("/auth/login")


def test_app_version_endpoint_is_uncached_and_uses_runtime_config(client, login, app):
    login("testuser")

    response = client.get("/api/app-version")

    assert response.status_code == 200
    assert response.get_json() == {"version": app.config["VERSION"]}
    assert "no-store" in response.headers["Cache-Control"]
    assert "no-cache" in response.headers["Cache-Control"]
    assert response.headers["Pragma"] == "no-cache"


def test_map_html_versions_static_assets(client, login, map_ids, app):
    login("testuser")
    version = app.config["VERSION"]

    response = client.get(f"/map/{map_ids['Own Map']}")
    html = response.get_data(as_text=True)

    assert response.status_code == 200
    assert f'data-app-version="{version}"' in html
    assert f"/static/css/style.css?v={version}" in html
    assert f"/static/js/dist/base.min.js?v={version}" in html
    assert f"/static/js/dist/map.min.js?v={version}" in html


def test_socket_reconnect_retries_without_a_fixed_attempt_limit():
    source = (ROOT / "static/js/base.js").read_text(encoding="utf-8")
    bundle = (ROOT / "static/js/dist/base.min.js").read_text(encoding="utf-8")

    assert "reconnectionAttempts: Infinity" in source
    assert "reconnectionDelayMax: 30000" in source
    # The generated asset served to browsers must contain the same recovery code.
    assert "reconnectionAttempts:1/0" in bundle
    assert "/api/app-version" in bundle


def test_version_check_is_uncached_and_reloads_once_on_mismatch():
    source = (ROOT / "static/js/base.js").read_text(encoding="utf-8")

    assert "fetch('/api/app-version'" in source
    assert "cache: 'no-store'" in source
    assert "versionReloadKey" in source
    assert "window.location.reload()" in source
    assert "window.setInterval" in source
