"""Static integrity checks for the frontend/test toolchain."""

from pathlib import Path

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
    assert "_live_quality_from_window(dev_id, metrics, thresholds)" in source
    assert "calculate_quality(metrics, thresholds)" in source


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


def test_single_realtime_status_event_can_update_quality():
    source = (ROOT / "static/js/src/map/index.js").read_text(encoding="utf-8")
    assert "quality_status: data.quality_status || 'unknown'" in source
    assert "if (node.data('status') === newStatus)" in source


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
