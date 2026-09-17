# LinkVision v2.2.2

![Python](https://img.shields.io/badge/Python-3.10+-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-3.1.3-green?logo=flask)
![License](https://img.shields.io/badge/License-MIT-yellow)

LinkVision — веб-приложение для визуализации и мониторинга сетевой инфраструктуры. Предоставляет инструменты для создания интерактивных карт сети, управления устройствами и их соединениями, а также отслеживания доступности узлов в реальном времени.

![Скриншот LinkVision](screenshots/screen_1.png)

## Возможности

### Карты и устройства
- **Создание карт сети** – несколько независимых карт с возможностью загрузки фонового изображения.
- **Управление устройствами** – добавление, редактирование и удаление устройств (коммутаторы, маршрутизаторы, серверы, ПК) с указанием IP-адресов и настраиваемыми иконками.
- **Вложенные группы устройств** – группы можно вкладывать друг в друга на любую глубину (группа внутри группы), с защитой от циклических зависимостей.
- **Сворачивание групп в «пузырёк»** – любую группу (и подгруппу) можно свернуть в компактный узел. Связи, ведущие внутрь свёрнутой группы, автоматически переподключаются к пузырьку. Цвет рамки пузырька отражает наихудший статус устройств внутри (down > partial > up), обновляется в реальном времени. Состояние свёрнутости сохраняется в браузере между сеансами.
- **Фигуры на карте** – добавление произвольных фигур (квадраты, прямоугольники, круги) для выделения зон.
- **Автоматическое разведение пересекающихся связей** – если несколько линий связи идут в почти одном направлении между разными узлами, они автоматически разводятся веером, чтобы не сливаться визуально.

### Связи и мониторинг
- **Настройка связей** – создание логических соединений между устройствами, выбор цвета, толщины и стиля линии. Предустановки для скоростей (100M–400G) и типов (VLAN, Radio).
- **Мониторинг доступности** – регулярная проверка устройств по ICMP-ping (`ping3` либо системный `ping`).
- **Обновление статуса в реальном времени** – через WebSocket статус устройств (UP/DOWN) мгновенно отображается на карте, с пульсацией для привлечения внимания.
- **Устойчивость к обрывам соединения** – при разрыве и восстановлении WebSocket-соединения карта автоматически переподключается к комнате и полностью пересинхронизирует состояние — без ручной перезагрузки страницы.
- **Усиление видимости проблем при отдалении карты** – на больших картах (200+ устройств) при масштабе «вписать всю карту» рамки недоступных устройств не становятся неразличимо мелкими.
- **Счётчик проблем** – количество недоступных устройств в сайдбаре пересчитывается «от истины» при каждой полной синхронизации.

### Управление доступом и безопасность
- **Многоуровневое управление пользователями** – администраторы, редакторы, операторы, зрители.
- **Права доступа к картам** – проверка владения на каждом изменяющем эндпоинте API.
- **Блокировка карт**, **аудит действий**.
- **CSRF-защита** на весь API, не только на формы.
- **Rate limiting** на попытки входа и регистрации.
- **HTTP security headers** – CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS (при HTTPS).

### Интерфейс
- **Мультиязычность** – русский/английский, часть строк переводится и на бэкенде (Flask-Babel).
- **Тёмная/светлая тема**, **адаптивный дизайн** (компактный тулбар на маленьких экранах).
- **Undo/Redo**, устойчивые к гонкам между отложенным сохранением позиции и ручной отменой.
- **Массовое редактирование** нескольких устройств одновременно.

## Требования

- **Python** 3.10+
- **pip**, **Git**
- Для production — **eventlet** (уже в `requirements.txt`) и возможность отправлять raw ICMP

## Автоматическая установка на Ubuntu (скрипт)

```bash
git clone https://github.com/Sivolen/LinkVision.git /opt/linkvision
cd /opt/linkvision
chmod +x install.sh
sudo ./install.sh
```

Скрипт **не** создаёт `config.py` (трекаемый файл репозитория — если его нет, клонирование прошло не полностью) и **не** создаёт пользователя `admin` с заранее известным паролем. Оба момента приложение делает само и безопасно при первом реальном запуске — см. ниже.

## Установка и запуск вручную

### 1. Клонирование

```bash
sudo git clone https://github.com/Sivolen/LinkVision.git /opt/linkvision
cd /opt/linkvision
sudo chown -R root:root /opt/linkvision
sudo chmod -R 755 /opt/linkvision
```

### 2. Виртуальное окружение

```bash
python -m venv venv
source venv/bin/activate
```

### 3. Зависимости

```bash
pip install -r requirements.txt
```

Для разработки фронтенда также нужен Node.js/npm:

```bash
npm install
npm run build
```

В production используются только собранные `static/js/dist/*.min.js`. Исходники `static/js/` автоматически пересобираются watcher'ом в dev-режиме.

### 4. Конфигурация

`config.py` — трекаемый файл репозитория, руками его редактировать не нужно почти никогда. Секреты и параметры окружения читаются из `.env` в корне проекта.

**`.env` создаётся автоматически при первом запуске** (`ensure_env_file()` в `app.py`) — со случайным `SECRET_KEY` и безопасными значениями по умолчанию. Можно и задать заранее:

```bash
cp .env.example .env
```

| Переменная | Назначение | По умолчанию |
|---|---|---|
| `SECRET_KEY` | Ключ подписи сессий/CSRF. Не задан — генерируется автоматически при первом запуске. | случайный |
| `DATABASE_URL` | PostgreSQL/MySQL. Не задана — SQLite (`webnetmap.db`). | SQLite |
| `LOG_LEVEL` | `DEBUG`/`INFO`/`WARNING`/`ERROR`/`CRITICAL`. | `INFO` |
| `FLASK_DEBUG` | Режим отладки. **Обязательно `False`/не задано в проде.** | `False` |
| `SESSION_COOKIE_SECURE` | Cookie только по HTTPS. | `True` (автоген.) |
| `BEHIND_PROXY` | Приложение за реверс-прокси (доверие к `X-Forwarded-*`). | `True` (автоген.) |
| `REDIS_URL` | Backend для rate limiting вместо in-memory. | не задано |
| `SENTRY_DSN` | Мониторинг ошибок. | не задано |

### 5. База данных и миграции

В текущей версии проекта **нет checked-in Alembic/Flask-Migrate цепочки**. Единственная поддерживаемая точка входа для структурных миграций SQLite — `apply_migrations.sh`. Приложение не изменяет схему существующей БД при старте.

Для новой или существующей SQLite-базы:

```bash
./apply_migrations.sh
```

Скрипт делает резервную копию существующей БД, применяет идемпотентные структурные изменения одной транзакцией, проверяет фактическую схему и только после успешной проверки обновляет `linkvision_schema.schema_version`. Маркер — это **маркер совместимости, а не номер миграции**.

В миграционный набор входят, в частности:
- `user.locale`;
- `group.parent_group_id`;
- `map.folder_id` и `map.position`;
- `map_folder`;
- `folder_permission` и `map_permission`;
- множественные IP, статусы, quality-поля, quality profiles и history;
- необходимые индексы.

`fix_db.py`, `migrate_ordering.py` и `migrate_quality.py` сохранены только как совместимые старые entrypoint'ы; новый код должен использовать `apply_migrations.sh`.

#### PostgreSQL

Для PostgreSQL `create_all()` используется **только для действительно пустой базы**. Если база уже содержит таблицы, приложение сначала проверяет наличие всех таблиц и полей текущей ORM-схемы и при несовместимости останавливается. Это сделано специально: `create_all()` не является безопасной миграцией существующей PostgreSQL-схемы.

Поэтому существующую PostgreSQL-базу нельзя обновлять запуском приложения в надежде, что схема «сама достроится». Перед запуском необходимо применить поддерживаемую миграцию для вашей схемы. Автоматической PostgreSQL-миграции в текущей версии нет.

### 6. Запуск для разработки

```bash
python app.py
```

### 7. Первый вход

Логин `admin`, пароль — **случайный**, печатается в консоли при первом запуске:
```
============================================================
  Temporary admin password: a1b2c3d4e5f6g7h8
============================================================
```
Система обязательно перенаправит на смену пароля. Пароль показывается один раз и не пишется в лог-файлы.

#### Сброс пароля администратора

```bash
python3 -c "
from app import create_app
from models import User
app = create_app()
with app.app_context():
    admin = User.query.filter_by(is_admin=True).first()
    admin.set_password('НовыйПароль123')
    admin.must_change_password = False
    from extensions import db
    db.session.commit()
    print(f'Пароль для {admin.username} изменён')
"
```

Либо удалить и создать заново:
```bash
sqlite3 webnetmap.db "DELETE FROM user WHERE username = 'admin';"
python app.py
```

### 8. Тесты

```bash
python -m pytest tests/ -v
```

### 9. systemd-сервис

Часть задач (raw ICMP) требует прав root — сервис настроен на запуск от root. Для публичных серверов рассмотрите обычного пользователя + `setcap`/`sudoers`.

`SECRET_KEY` и остальные переменные **не нужно** прописывать в самом юните — `.env` читается приложением самостоятельно (создаётся автоматически при первом запуске).

```bash
sudo ln -s /opt/linkvision/linkvision.service /etc/systemd/system/linkvision.service
sudo systemctl daemon-reload
sudo systemctl enable linkvision.service
sudo systemctl start linkvision.service
sudo systemctl status linkvision.service
```

Пароль администратора при первом запуске под systemd — в логе сервиса:
```bash
sudo journalctl -u linkvision.service -n 50 | grep -A2 "Temporary admin password"
```

## Использование

- **Карта** – «Новая карта» в сайдбаре, при желании — фон.
- **Устройство** – кнопка «Устройство» на панели инструментов.
- **Связь** – режим «Связь», выбрать два устройства, настроить линию в открывшемся окне.
- **Группы и подгруппы** – контекстное меню группы → создать вложенную подгруппу, либо выбрать родителя прямо в форме редактирования. Двойной клик по группе или пункт меню — сворачивает/разворачивает в «пузырёк».
- **Мониторинг** – статусы обновляются автоматически; на свёрнутых группах и при сильном отдалении статус агрегируется.
- **Администрирование** – раздел в сайдбаре для администраторов: пользователи, типы устройств, настройки мониторинга.

### Настройка мониторинга

`/admin/settings`: количество ICMP-пакетов на проверку (по умолчанию 4), интервал опроса (по умолчанию 10 сек). Изменения — со следующего цикла.

### Структура проекта

```
linkvision/
├── app.py                       # точка входа; порядок важен — .env грузится ДО импорта config/logger
├── wsgi.py                      # WSGI для production
├── config.py                    # секретный ключ, БД, CSP, i18n, версия
├── extensions.py                 # SQLAlchemy, LoginManager, SocketIO, Babel
├── models.py                    # User, Map, Device, Link, Group (+parent_group_id), Settings
├── forms.py
├── requirements.txt
├── babel.cfg                    # извлечение строк для перевода (Flask-Babel)
├── apply_migrations.sh           # единая точка входа миграций SQLite
├── fix_db.py                    # совместимый старый entrypoint
├── install.sh
├── linkvision.service
├── .env.example
├── translations/                 # .po/.mo переводов интерфейса (ru/en)
├── blueprints/
│   ├── auth.py                  # вход/регистрация/выход/смена пароля
│   ├── admin.py                  # пользователи/типы/настройки/резервные копии
│   ├── main.py                   # дашборд/карта/создание карты
│   ├── i18n.py                   # переключение языка
│   └── api/
│       ├── maps.py               # карты, блокировка, импорт/экспорт
│       ├── devices.py / links.py / groups.py / shapes.py
│       ├── permissions.py / audit.py
├── services/
│   ├── user_service.py / device_service.py / link_service.py
│   ├── group_service.py          # вложенность, защита от циклов
│   ├── shape_service.py
│   ├── map_service.py            # сериализация элементов для фронтенда
│   ├── map_import_export_service.py
│   ├── device_type_service.py / settings_service.py
│   ├── permissions.py / permission_service.py
│   ├── security_service.py       # rate limiting, блокировка аккаунтов
│   ├── notifications.py          # WebSocket
│   ├── monitor.py                # фоновый мониторинг
│   ├── validators.py / audit_service.py
│   ├── js_i18n.py                # словарь переводов для фронтенда
│   └── db/                       # device_repository.py, map_repository.py
├── utils/
│   ├── logger.py / file_validation.py
├── static/
│   ├── css/
│   └── js/
│       ├── base.js / common.js               # исходники
│       ├── dist/                             # собранные *.min.js
│       │   ├── base.min.js / common.min.js
│       │   ├── map.min.js / modal.min.js
│       │   └── ...
│       └── src/
│           ├── map/
│           │   ├── core.js                   # ядро карты, реестр cleanup-модулей
│           │   ├── moduleRegistry.js         # саморегистрация cleanup-функций
│           │   ├── elements.js               # загрузка/добавление элементов
│           │   ├── interactions.js           # drag/drop, клики, контекст. меню
│           │   ├── groupResize.js            # авторазмер групп
│           │   ├── groupCollapse.js          # сворачивание в «пузырёк»
│           │   ├── edgeBundling.js           # разведение пересекающихся связей
│           │   ├── zoomEmphasis.js           # видимость алярмов при отдалении
│           │   ├── modes.js / lock.js / sidebar.js / layout.js
│           │   ├── styles.js / pulse.js / search.js / fullscreen.js
│           │   ├── undoRedo.js / edgeLabels.js / viewport.js
│           │   ├── minimap.js / bulk.js / ids.js
│           │   └── index.js                  # инициализация, socket-обработчики
│           ├── modal/
│           │   ├── device.js / shape.js / group.js / link.js
│           │   ├── permissions.js / history.js
│           │   ├── mapIntegration.js         # сохранение/восстановление viewport
│           │   └── ipManager.js / utils.js
│           ├── i18n/                         # ru.json / en.json / i18n.js
│           └── utils/                        # http, toast, state, csrf
├── templates/
│   ├── base.html / login.html / register.html
│   ├── dashboard.html / map_view.html / no_maps.html
│   ├── 404.html / 429.html
│   └── admin/
├── tests/                        # pytest: сервисы, права доступа, CSRF
└── logs/                         # создаётся автоматически
```

### Обновление через systemd

Для SQLite порядок обновления такой:

```bash
sudo systemctl stop linkvision.service
cd /opt/linkvision && sudo git pull
sudo /opt/linkvision/venv/bin/pip install -r requirements.txt
sudo /opt/linkvision/apply_migrations.sh
sudo systemctl start linkvision.service
sudo journalctl -u linkvision.service -n 20
```

`apply_migrations.sh` должен завершиться успешно **до** запуска приложения. Если схема старая или повреждена, приложение не будет пытаться менять её самостоятельно.

### Обновление старых баз

Для SQLite не нужно вручную добавлять `parent_group_id`, `locale`, `map_folder` или permission-таблицы. Все поддерживаемые структурные изменения выполняет единый миграционный набор:

```bash
cd /opt/linkvision
sudo systemctl stop linkvision.service
sudo ./apply_migrations.sh
sudo systemctl start linkvision.service
```

Перед миграцией создаётся файл резервной копии вида `webnetmap.db.migration_backup_YYYYMMDD_HHMMSS`.

Если миграция завершается ошибкой, приложение запускать не следует: сначала исправьте причину или восстановите резервную копию.

### Логи

```bash
tail -f logs/app.log
tail -f logs/auth.log
tail -f logs/api.log
du -sh logs/*
```

## Используемые технологии

**Backend:** Flask, Flask-SQLAlchemy, Flask-Login, Flask-SocketIO, Flask-Babel, Flask-WTF, Eventlet, ping3, pytest.

**Frontend:** Bootstrap 5, Font Awesome 6, Cytoscape.js (в т.ч. вложенные compound-узлы для групп), Socket.IO client (с автопересинхронизацией при реконнекте), ES6-модули, esbuild.

**Безопасность:** проверка владения на каждом изменяющем API-эндпоинте, CSRF на весь API, security-заголовки на каждый ответ, автогенерируемый `SECRET_KEY`, rate limiting, одноразовый временный пароль администратора.

**База данных:** SQLite по умолчанию, PostgreSQL/MySQL через `DATABASE_URL`.

## Лицензия

MIT — см. файл LICENSE.

---
LinkVision – инструмент для удобного и наглядного контроля сетевой инфраструктуры.
