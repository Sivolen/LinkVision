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
                assert token not in line, f"Unbundled script reference in {template}: {token}"


def test_watch_script_ignores_generated_bundles():
    package = (ROOT / "package.json").read_text(encoding="utf-8")
    assert "--ignore static/js/dist/**" in package


def test_run_tests_does_not_reference_missing_test_modules():
    runner = (ROOT / "run_tests.sh").read_text(encoding="utf-8")
    assert "tests/test_api.py" not in runner
    assert "tests/test_integration.py" not in runner
