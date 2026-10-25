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
    assert response.get_json() == {
        "version": app.config["VERSION"],
        "build": app.config["BUILD_ID"],
    }
    assert "no-store" in response.headers["Cache-Control"]
    assert "no-cache" in response.headers["Cache-Control"]
    assert response.headers["Pragma"] == "no-cache"


def test_map_html_versions_static_assets(client, login, map_ids, app):
    login("testuser")
    version = app.config["VERSION"]

    response = client.get(f"/map/{map_ids['Own Map']}")
    html = response.get_data(as_text=True)

    assert response.status_code == 200
    build = app.config["BUILD_ID"]
    assert f'data-app-version="{version}"' in html
    assert f'data-app-build="{build}"' in html
    # В URL статики попадает и версия, и хеш сборки: кэш сбрасывается, даже если
    # VERSION забыли поднять.
    assert f"/static/css/style.css?v={version}-{build}" in html
    assert f"/static/js/dist/base.min.js?v={version}-{build}" in html
    assert f"/static/js/dist/map.min.js?v={version}-{build}" in html


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


def test_build_id_is_short_hash_of_frontend_files():
    from config import Config

    assert len(Config.BUILD_ID) == 8
    int(Config.BUILD_ID, 16)  # только hex-символы


def test_server_initiated_disconnect_is_reconnected_manually():
    source = (ROOT / "static/js/base.js").read_text(encoding="utf-8")

    # Socket.IO не переподключается сам после 'io server disconnect'.
    assert "reason === 'io server disconnect'" in source
    assert "scheduleManualReconnect()" in source
    assert "!window.socket.active" in source


def test_version_reload_waits_until_user_is_idle():
    source = (ROOT / "static/js/base.js").read_text(encoding="utf-8")

    assert "reloadWhenIdle(serverVersion)" in source
    assert "window.isMapBusy" in source
    assert ".modal.show" in source
    # build сравнивается только если известен и серверу, и странице.
    assert "serverBuild && pageBuild" in source


def test_load_elements_keeps_graph_until_response_and_ignores_stale_replies():
    source = (ROOT / "static/js/src/map/elements.js").read_text(encoding="utf-8")
    body = source[source.index("export function loadElements") :]
    body = body[: body.index("export async function addDeviceToGraph")]

    # Граф очищается только внутри успешного ответа (после fetch), не до него.
    assert body.index("fetchWithRetry(") < body.index("cy.elements().remove()")
    assert "const reqId = ++loadSeq" in body
    assert "reqId !== loadSeq" in body
    # Ошибка загрузки не оставляет карту пустой навсегда: есть повторы.
    assert "scheduleLoadRetry(mapId, attempt)" in body


def test_reconnect_resync_is_deferred_while_user_is_busy():
    source = (ROOT / "static/js/src/map/index.js").read_text(encoding="utf-8")

    assert "scheduleResync(" in source
    assert "initResync(cy" in source
    assert "window.isMapBusy = isMapBusy" in source
    # Флаг первой загрузки ставится по факту загрузки, а не сразу.
    assert "window.__mapLoadedOnce = true;\n\n    loadElements" not in source


def test_request_status_answers_only_the_requesting_client():
    source = (ROOT / "app.py").read_text(encoding="utf-8")
    block = source[source.index('socketio.on("request_status")') :]

    assert "room=request.sid" in block
    assert 'room=f"map_{map_id}"' not in block
    assert "isinstance(data, dict)" in block


def test_socketio_heartbeat_and_cors_are_configured():
    source = (ROOT / "extensions.py").read_text(encoding="utf-8")

    assert "Config.SOCKETIO_PING_INTERVAL" in source
    assert "Config.SOCKETIO_PING_TIMEOUT" in source
    # Авторизация по cookie: "*" по умолчанию недопустим.
    assert 'cors_allowed_origins="*"' not in source
    assert "SOCKETIO_CORS_ORIGINS" in source
