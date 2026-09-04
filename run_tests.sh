#!/bin/bash
# Script to run LinkVision tests

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TEST_TYPE=${1:-all}
COVERAGE=${2:-false}

PYTEST_ARGS=()
if [[ "$COVERAGE" == "true" ]]; then
    PYTEST_ARGS+=(--cov=services --cov-report=term-missing)
fi

run_pytest() {
    pytest -v "${PYTEST_ARGS[@]}" "$@"
}

run_frontend() {
    if command -v npm >/dev/null 2>&1; then
        npm run test:frontend
        npm run test:js
    else
        echo "WARNING: npm not found; frontend tests skipped."
    fi
}

case "$TEST_TYPE" in
    unit)
        run_pytest tests/test_services.py tests/test_security.py tests/test_permissions.py
        ;;
    integration)
        run_pytest \
            tests/test_import_export.py \
            tests/test_lock_and_permissions.py \
            tests/test_nested_groups.py \
            tests/test_realtime_events.py \
            tests/test_notifications.py
        ;;
    api)
        run_pytest \
            tests/test_auth.py \
            tests/test_import_export.py \
            tests/test_lock_and_permissions.py \
            tests/test_nested_groups.py \
            tests/test_notifications.py \
            tests/test_realtime_events.py
        ;;
    frontend)
        run_frontend
        ;;
    all)
        run_pytest tests/
        run_frontend
        ;;
    *)
        echo "Usage: $0 [unit|integration|api|frontend|all] [true|false]"
        exit 1
        ;;
esac

echo "LinkVision tests completed successfully!"
echo "=========================================="
