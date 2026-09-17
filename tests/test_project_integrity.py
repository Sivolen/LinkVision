"""Static integrity checks for the frontend/test toolchain."""

import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_required_frontend_bundles_exist_and_are_nonempty():
    for relative in (
        "static/js/dist/base.min.js",
        "static/js/dist/common.min.js",
        "static/js/dist/map.min.js",
        "static/js/dist/modal.min.js",
    ):
        path = ROOT / relative
        assert path.is_file(), f"Missing frontend bundle: {relative}"
        assert path.stat().st_size > 0, f"Empty frontend bundle: {relative}"


def test_templates_do_not_load_unbundled_application_modules():
    templates = [ROOT / "templates" / "base.html", ROOT / "templates" / "map_view.html"]
    forbidden = ("js/base.js", "js/common.js", "js/map.js", "js/modal.js")

    for template in templates:
        text = template.read_text(encoding="utf-8")
        # Comments are allowed as documentation; actual script tags are not.
        for line in text.splitlines():
            if "<!--" in line and "-->" in line:
                continue
            for token in forbidden:
                assert (
                    token not in line
                ), f"Unbundled script reference in {template}: {token}"


def test_watch_script_ignores_generated_bundles():
    package = (ROOT / "package.json").read_text(encoding="utf-8")
    assert "--ignore static/js/dist/**" in package


def test_run_tests_does_not_reference_missing_test_modules():
    runner = (ROOT / "run_tests.sh").read_text(encoding="utf-8")
    assert "tests/test_api.py" not in runner
    assert "tests/test_integration.py" not in runner


def test_realtime_status_batch_applies_quality_even_when_status_is_unchanged():
    source = (ROOT / "static/js/src/map/index.js").read_text(encoding="utf-8")
    assert "quality_status: item.quality_status || 'unknown'" in source
    assert "quality_latency_ms: item.quality_latency_ms ?? null" in source
    assert "quality_jitter_ms: item.quality_jitter_ms ?? null" in source
    assert "quality_loss_percent: item.quality_loss_percent ?? null" in source


def test_monitor_uses_rolling_quality_window_before_live_classification():
    source = (ROOT / "services/monitor.py").read_text(encoding="utf-8")
    assert "QUALITY_LIVE_MIN_SAMPLES = 8" in source
    # 8 пакетов = два цикла при типичной настройке 4 пакета/цикл;
    # latency/jitter при этом оцениваются сразу, а короткая потеря не флапает карту.
    # Вызов ищем по нормализованному источнику: black переносит аргументы
    # вызова на отдельные строки, и проверка сырой подстроки падала бы от
    # одного форматирования (90-символьная строка на границе лимита).
    # Схлопывание переносов оставляет пробелы вокруг скобок и запятых —
    # убираем их, чтобы сравнение не зависело от раскладки вызова.
    normalized = " ".join(source.split())
    normalized = normalized.replace("( ", "(").replace(" )", ")").replace(", ", ",")
    assert "_live_quality_from_window(dev_id,metrics,thresholds)" in normalized
    assert "calculate_quality(metrics,thresholds)" in normalized


def test_migrations_have_single_entrypoint():
    script = (ROOT / "apply_migrations.sh").read_text(encoding="utf-8")
    assert '"$PYTHON_BIN" "$ROOT_DIR/migrate_db.py"' in script
    assert "migrate_ordering.py" not in script
    assert "migrate_quality.py" not in script
    assert "migrate_quality_profile.py" not in script


def test_quality_profile_service_validates_threshold_order():
    source = (ROOT / "services/quality_service.py").read_text(encoding="utf-8")
    assert "def validate_quality_thresholds" in source
    assert ">= float(thresholds[bad])" in source or ">= float(thresholds[" in source


def test_quality_card_contains_chart_structure():
    source = (ROOT / "static/js/src/modal/quality.js").read_text(encoding="utf-8")
    assert "quality-chart-svg" in source
    assert "quality-chart-grid" in source
    assert "quality-chart-line" in source


def test_request_status_contains_quality_fields():
    source = (ROOT / "app.py").read_text(encoding="utf-8")
    assert 'socketio.on("request_status")' in source
    for key in (
        "quality_status",
        "quality_latency_ms",
        "quality_jitter_ms",
        "quality_loss_percent",
    ):
        assert f'"{key}": d.{key}' in source


def test_request_status_resyncs_disabled_devices_and_quality():
    source = (ROOT / "app.py").read_text(encoding="utf-8")
    assert "devices = Device.query.filter_by(map_id=map_id).all()" in source
    assert '"monitoring_enabled": d.monitoring_enabled' in source
    assert 'd.quality_status if d.monitoring_enabled else "unknown"' in source


def test_socket_connect_is_single_resync_path():
    source = (ROOT / "static/js/base.js").read_text(encoding="utf-8")
    connect_block = source[source.index("window.socket.on('connect',") : source.index("window.socket.on('connect_error'")]
    assert "request_status" in connect_block
    assert "window.socket.on('reconnect'" not in connect_block


def test_single_realtime_status_event_can_update_quality():
    source = (ROOT / "static/js/src/map/index.js").read_text(encoding="utf-8")
    assert "quality_status: data.quality_status || 'unknown'" in source
    assert "if (node.data('status') === newStatus)" in source


def test_frontend_escapes_user_controlled_html_and_inline_js_values():
    base = (ROOT / "static/js/base.js").read_text(encoding="utf-8")
    permissions = (ROOT / "static/js/src/modal/permissions.js").read_text(
        encoding="utf-8"
    )
    group = (ROOT / "static/js/src/modal/group.js").read_text(encoding="utf-8")

    # Имена карт/папок попадают в inline onclick: одного escapeHtml недостаточно
    # для апострофов, поэтому используется отдельное JS-экранирование.
    assert "function escapeJsString(str)" in base
    # Полная цепочка из трёх слоёв: escapeJsString закрывает одинарные кавычки
    # JS-литерала, escapeHtml — теги/сущности, явная замена &quot; — двойные
    # кавычки HTML-атрибута (escapeHtml на textContent их НЕ экранирует, и
    # имя вида x" onmouseover="... разрывало атрибут — проверено парсером).
    for kind in ("map.name", "folder.name"):
        assert (
            f"const safeName = escapeHtml(escapeJsString({kind}))"
            ".replace(/\"/g, '&quot;');" in base
        ), f"неполная цепочка экранирования для {kind}"
    assert "escapeHtml(err.message)" in base

    # Имя пользователя и сообщение исключения нельзя вставлять в innerHTML
    # без экранирования.
    assert "<td>${escapeHtml(nameLabel)}</td>" in permissions
    assert "escapeHtml(t('modal.group.loadError', { msg: err.message }))" in group


@pytest.mark.skipif(shutil.which("node") is None, reason="node недоступен")
def test_sidebar_name_escape_chain_blocks_quote_injection():
    """Поведенческая проверка цепочки экранирования из base.js.

    Статических assert мало: цепочка может выглядеть правильной и всё равно
    пропускать разрыв атрибута (так и было, пока &quot;-замена не добавили).
    Функции извлекаются из реального исходника и исполняются в node, поэтому
    тест ловит и порчу самой реализации, а не только удаление вызова.
    """
    import json
    import subprocess

    base = (ROOT / "static/js/base.js").read_text(encoding="utf-8")

    def extract(name):
        start = base.index(f"function {name}(str) {{")
        depth = 0
        for i in range(start, len(base)):
            if base[i] == "{":
                depth += 1
            elif base[i] == "}":
                depth -= 1
                if depth == 0:
                    return base[start : i + 1]
        raise AssertionError(f"function {name} не замкнута")

    script = (
        # escapeHtml опирается на DOM (textContent/innerHTML). Стаб повторяет
        # сериализацию текста по спеке HTML: & < > и nbsp — и СОЗНАТЕЛЬНО не
        # трогает кавычки, ровно как реальный браузерный innerHTML. На этом
        # факте и построен тест: если цепочка полагается на escapeHtml для
        # двойных кавычек — она обязана провалиться.
        "const document = { createElement: () => {\n"
        "  let t = '';\n"
        "  return {\n"
        "    set textContent(v) { t = String(v); },\n"
        "    get innerHTML() {\n"
        "      return t.replace(/&/g, '&amp;').replace(/</g, '&lt;')\n"
        "              .replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');\n"
        "    },\n"
        "  };\n"
        "}};\n" + extract("escapeHtml") + "\n" + extract("escapeJsString") + """
// Злоупотребление собирается из кодов, чтобы не вложенные экранирования
// самого теста определяли, что именно уходит в цепочку:
// a" onmouseover="alert(1)'b<>, бэкслеш и перевод строки.
const dq = String.fromCharCode(34), q = String.fromCharCode(39);
const bs = String.fromCharCode(92), nl = String.fromCharCode(10);
const evil = 'a' + dq + ' onmouseover=' + dq + 'alert(1)' + q + 'b<>' + bs + nl;
const safe = escapeHtml(escapeJsString(evil)).replace(/"/g, '&quot;');
// Инварианты значения внутри onclick с JS-литералом внутри:
// 1) сырой " закрыл бы HTML-атрибут; 2) неэкранированный ' закрыл бы
// JS-литерал; 3) сырые < > ломали бы разметку; 4) реальный перевод строки
// разорвал бы JS-выражение обработчика.
const badQuote = safe.includes(String.fromCharCode(34));
// Каждый ' обязан предваряться бэкслешем: escapeJsString превращает ' в \'
let badApos = false;
for (let i = 0; i < safe.length; i++) {
  if (safe[i] === q && safe[i - 1] !== bs) badApos = true;
}
console.log(JSON.stringify({ safe, badQuote, badApos }));
"""
    )
    proc = subprocess.run(
        ["node", "-e", script], capture_output=True, text=True, timeout=30
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert not out["badQuote"], f"двойная кавычка разрывает атрибут: {out['safe']}"
    assert not out["badApos"], f"апостроф ломает JS-литерал: {out['safe']}"
    assert "<" not in out["safe"] and ">" not in out["safe"]
    assert "\n" not in out["safe"]


def test_tab_focus_resync_and_card_node_sync_present():
    """Реальные потери volatile-эмитов лечатся двумя путями ресинка.

    visibilitychange ловит случай «вкладка свёрнута, сокет формально жив»
    (socket 'reconnect' при этом не срабатывает вообще), syncNodeFromDetails
    чинит уже раскрывшуюся расхождение ноды с БД в момент открытия карточки.
    """
    base = (ROOT / "static/js/base.js").read_text(encoding="utf-8")
    assert "visibilitychange" in base
    assert "document.visibilityState === 'visible'" in base

    device = (ROOT / "static/js/src/modal/device.js").read_text(encoding="utf-8")
    assert "function syncNodeFromDetails(node, data)" in device
    assert "syncNodeFromDetails(node, data);" in device
    # Счётчик сайдбара дельтовый, поэтому синк ноды обязан править и его.
    assert "window.updateSidebarCounter" in device
    # updateSidebarCounter живёт в map-бандле — без экспорта на window modal
    # -бандл до него не достанет.
    map_index = (ROOT / "static/js/src/map/index.js").read_text(encoding="utf-8")
    assert "window.updateSidebarCounter = updateSidebarCounter;" in map_index


def test_bundles_are_not_stale_relative_to_sources():
    """Ловит «поправил src, забыл npm run build»: шаблоны грузят только dist/.

    Мокрый тест на поведение здесь неуместен (нет браузерного рантайма), а
    именно эта ошибка уже приводила к тому, что смерженный JS-код не работал
    в проде, хотя все тесты были зелёные.

    Окно исходников совпадает с тем, что реально заходит в бандл: base/common
    минифицируются из одного файла без --bundle, modal/map бандлятся из своих
    каталогов. Иначе тест валил бы сборку без всякого основания.
    """
    cases = [
        ("static/js/dist/base.min.js", [ROOT / "static/js/base.js"]),
        ("static/js/dist/common.min.js", [ROOT / "static/js/common.js"]),
        (
            "static/js/dist/modal.min.js",
            sorted((ROOT / "static/js/src/modal").glob("*.js")),
        ),
        (
            "static/js/dist/map.min.js",
            sorted((ROOT / "static/js/src/map").glob("*.js")),
        ),
    ]
    for bundle_rel, sources in cases:
        bundle = ROOT / bundle_rel
        assert bundle.is_file(), f"Missing bundle: {bundle_rel}"
        newest = max((p.stat().st_mtime for p in sources), default=0.0)
        assert (
            bundle.stat().st_mtime >= newest
        ), f"{bundle_rel} is older than its sources — run `npm run build`"


def test_monitor_pool_size_is_configurable_not_cpu_bound():
    """Размер пула мониторинга настраивается и не привязан к числу ядер."""
    monitor = (ROOT / "services/monitor.py").read_text(encoding="utf-8")
    assert "def _compute_max_workers()" in monitor
    assert 'get_setting("monitor_max_workers"' in monitor
    assert "MONITOR_MAX_WORKERS_HARD_CAP = 300" in monitor
    assert "min(50, (os.cpu_count() or 1) * 4)" not in monitor
    # Батч-барьер убран: он заставлял простаивать весь пул из-за одного
    # недоступного устройства в батче.
    assert "batch_size = 50" not in monitor

    for setting_key, where in (
        ("monitor_max_workers", ROOT / "app.py"),
        ("monitor_max_workers", ROOT / "templates/admin/settings.html"),
        ("monitor_max_workers", ROOT / "services/settings_service.py"),
    ):
        assert setting_key in where.read_text(
            encoding="utf-8"
        ), f"{setting_key} missing in {where}"


def test_startup_does_not_mutate_existing_schema():
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    assert "_ensure_user_locale_column" not in app
    assert 'ALTER TABLE "user" ADD COLUMN locale' not in app
    assert "validate_database_schema(db.engine, db.metadata)" in app
    assert "if not inspector.get_table_names():" in app


def test_flask_migrate_is_not_advertised_as_the_project_migration_engine():
    requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    extensions = (ROOT / "extensions.py").read_text(encoding="utf-8")
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    assert "Flask-Migrate" not in requirements
    assert "flask_migrate" not in extensions
    assert "flask_migrate" not in app


def test_install_uses_single_migration_entrypoint():
    install = (ROOT / "install.sh").read_text(encoding="utf-8")
    assert "apply_migrations.sh" in install
    assert "flask db upgrade" not in install
    assert "fix_db.py" not in install


def test_logout_is_post_only_and_csrf_protected_by_form():
    auth = (ROOT / "blueprints/auth.py").read_text(encoding="utf-8")
    base = (ROOT / "templates/base.html").read_text(encoding="utf-8")
    assert '@auth_bp.route("/logout", methods=["POST"])' in auth
    assert 'action="{{ url_for(\'auth.logout\') }}"' in base
    assert 'name="csrf_token" value="{{ csrf_token() }}"' in base


def test_security_headers_include_browser_hardening_directives():
    app = (ROOT / "app.py").read_text(encoding="utf-8")
    assert 'response.headers["X-Content-Type-Options"] = "nosniff"' in app
    assert 'response.headers["X-Frame-Options"] = "SAMEORIGIN"' in app
    assert 'response.headers["Permissions-Policy"]' in app
    assert '"object-src \'none\'; "' in app
    assert '"base-uri \'self\'; "' in app
    assert '"form-action \'self\'; "' in app


def test_remember_cookie_uses_secure_defaults():
    config = (ROOT / "config.py").read_text(encoding="utf-8")
    assert 'REMEMBER_COOKIE_HTTPONLY = True' in config
    assert 'REMEMBER_COOKIE_SAMESITE = "Lax"' in config
    assert 'REMEMBER_COOKIE_SECURE = SESSION_COOKIE_SECURE' in config


def test_redirect_validation_rejects_protocol_relative_targets():
    auth = (ROOT / "blueprints/auth.py").read_text(encoding="utf-8")
    i18n = (ROOT / "blueprints/i18n.py").read_text(encoding="utf-8")
    expected = 'and not target.startswith("//")'
    assert auth.count(expected) == 1
    assert i18n.count(expected) == 1
