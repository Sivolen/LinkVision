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
    assert "QUALITY_LIVE_MIN_SAMPLES = 100" in source
    assert "_live_quality_from_window(dev_id, metrics)" in source
    assert "calculate_quality(metrics)" in source
