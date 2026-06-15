#!/bin/bash
# Скрипт для применения миграций базы данных LinkVision v2.0

set -e

echo "🔧 LinkVision - Применение миграций БД"
echo "======================================"

# Активация виртуального окружения если существует
if [ -d "venv" ]; then
    source venv/bin/activate
    echo "✅ Виртуальное окружение активировано"
fi

# Проверка наличия файла migrations
if [ ! -d "migrations" ]; then
    echo "❌ Папка migrations не найдена. Создаю..."
    flask db init
    flask db migrate -m "Initial migration"
fi

# Применение миграций
echo "📦 Применение миграций..."
flask db upgrade

echo "✅ Миграции успешно применены"
echo ""
echo "📊 Информация о версии БД:"
flask db current
