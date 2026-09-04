#!/usr/bin/env bash
# Простая проверка целостности frontend-зависимостей.
# Запускается через npm run test:frontend.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ERRORS=0

# 1. Бандлы должны существовать и быть не пустыми
for bundle in \
    static/js/dist/base.min.js \
    static/js/dist/common.min.js \
    static/js/dist/map.min.js \
    static/js/dist/modal.min.js; do
    if [ ! -f "$bundle" ]; then
        echo "FAIL: missing bundle $bundle"
        ERRORS=$((ERRORS + 1))
    elif [ ! -s "$bundle" ]; then
        echo "FAIL: empty bundle $bundle"
        ERRORS=$((ERRORS + 1))
    fi
done

# 2. Шаблоны не должны содержать незакомментированных ссылок на unbundled JS
for template in templates/base.html templates/map_view.html; do
    while IFS= read -r line; do
        # Пропускаем закомментированные строки
        if [[ "$line" == *"<!--"* ]] && [[ "$line" == *"-->"* ]]; then
            continue
        fi
        for token in "js/base.js" "js/common.js" "js/map.js" "js/modal.js"; do
            if [[ "$line" == *"$token"* ]]; then
                echo "FAIL: unbundled script reference in $template: $line"
                ERRORS=$((ERRORS + 1))
            fi
        done
    done < "$template"
done

# 3. package.json должен содержать --ignore для dist
if ! grep -q -- "--ignore static/js/dist/**" package.json; then
    echo "FAIL: package.json missing --ignore static/js/dist/**"
    ERRORS=$((ERRORS + 1))
fi

# 4. run_tests.sh не должен ссылаться на отсутствующие модули
if grep -q "tests/test_api.py" run_tests.sh; then
    echo "FAIL: run_tests.sh references removed test_api.py"
    ERRORS=$((ERRORS + 1))
fi
if grep -q "tests/test_integration.py" run_tests.sh; then
    echo "FAIL: run_tests.sh references removed test_integration.py"
    ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
    echo "Frontend integrity check FAILED: $ERRORS error(s)"
    exit 1
fi

echo "Frontend integrity check passed."
