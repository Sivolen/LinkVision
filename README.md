# LinkVision

**LinkVision 2.2.2** — веб-приложение для визуализации и мониторинга сетевой инфраструктуры.

LinkVision позволяет собрать сетевую инфраструктуру на интерактивной карте, организовать карты по папкам, объединять устройства во вложенные группы, настраивать связи и следить за доступностью узлов в реальном времени.

![Интерфейс LinkVision](screenshots/screen_1.png)

> Скриншот интерфейса из текущей версии проекта. Файл находится в `screenshots/screen_1.png`.

---

## Что умеет LinkVision

### 🗺️ Интерактивные карты

- несколько независимых карт сети;
- фоновые изображения карт;
- устройства, связи и произвольные фигуры;
- drag & drop и сохранение положения объектов;
- блокировка карты от случайного редактирования;
- поиск по объектам;
- полноэкранный режим и мини-карта;
- автоматическое разведение близких/пересекающихся связей;
- undo/redo для операций с картой;
- массовое редактирование устройств.

### 📁 Папки и права доступа

Карты можно организовывать в дерево папок и подпапок.

Поддерживаются:

- перемещение карт между папками;
- вложенные папки;
- порядок карт и папок;
- права на папки;
- права непосредственно на отдельные карты;
- роли просмотра и редактирования;
- проверка прав на серверной стороне для изменяющих операций.

Права не являются только UI-механизмом: API повторно проверяет доступ перед выполнением защищённых действий.

### 👥 Группы устройств

- группы устройств;
- вложенные группы любой глубины;
- защита от циклических зависимостей;
- изменение родительской группы;
- сворачивание группы в компактный «пузырёк»;
- агрегированный статус свёрнутой группы;
- сохранение состояния свёрнутости в браузере.

### 🔗 Связи

Для каждой связи можно задавать:

- источник и назначение;
- интерфейсы;
- тип связи;
- цвет;
- толщину;
- стиль линии;
- размер подписи.

Есть предустановки для распространённых скоростей и типов соединений.

### 📡 Мониторинг доступности

Мониторинг выполняет регулярные ICMP-проверки устройств.

Поддерживаются два backend'а проверки:

- `ping3`;
- системная команда `ping` как fallback, если raw ICMP из Python недоступен.

Настраиваются:

- количество ICMP-пакетов за проверку;
- интервал между циклами;
- timeout;
- максимальный размер пула мониторинга.

Пул мониторинга может изменяться без искусственного ограничения на количество устройств в одном батче. Для текущей версии предусмотрен диапазон `10–300` workers, значение по умолчанию — `150`.

### 📈 Качество ICMP

Помимо UP/DOWN, LinkVision собирает показатели качества:

- packet loss;
- latency;
- jitter;
- итоговый статус качества.

Есть профили качества с настраиваемыми порогами. Один профиль может использоваться как профиль по умолчанию.

История качества хранится в агрегированном виде. Для текущей версии стандартное окно хранения истории качества — 30 дней, а общая история мониторинга настраивается через `history_retention_days` (по умолчанию 7 дней).

Короткие всплески потерь не должны мгновенно менять отображаемое качество: для live-классификации используется накопительное окно.

### ⚡ WebSocket и realtime

Изменения состояния устройств передаются клиентам через Socket.IO/WebSocket.

Это позволяет без перезагрузки страницы обновлять:

- UP/DOWN;
- качество связи;
- latency;
- jitter;
- packet loss;
- состояние объектов на карте и в свёрнутых группах.

После восстановления WebSocket-соединения клиент повторно присоединяется к комнате карты и запрашивает актуальное состояние. Для устройств с выключенным мониторингом сервер также возвращает явное состояние `monitoring_enabled=false`, чтобы клиент не оставлял старый статус.

### 📦 Импорт и экспорт

Карта экспортируется в JSON и может быть импортирована обратно.

В текущем формате учитываются:

- карта;
- устройства;
- множественные IP-адреса;
- группы и их иерархия;
- связи;
- фигуры;
- параметры отображения.

При импорте выполняется проверка структуры, ссылок между объектами и иерархии групп. Старые JSON без новых необязательных полей должны оставаться совместимыми.

### 🔐 Безопасность

В проекте реализованы:

- CSRF-защита POST/PUT/DELETE-запросов;
- POST-only logout;
- безопасная проверка redirect URL;
- защита от protocol-relative redirect (`//host`);
- серверная проверка владельца/прав доступа;
- rate limiting для чувствительных операций;
- security-заголовки;
- CSP;
- `Permissions-Policy`;
- `X-Content-Type-Options`;
- `X-Frame-Options`;
- `Referrer-Policy`;
- HttpOnly/SameSite для remember-cookie;
- Secure cookies для HTTPS;
- случайный `SECRET_KEY` в автоматически создаваемом `.env`.

В production рекомендуется размещать приложение за HTTPS reverse proxy.

### 🌍 Интерфейс

- русский и английский языки;
- тёмная и светлая тема;
- адаптивный интерфейс;
- административный раздел;
- управление пользователями и типами устройств;
- настройки мониторинга.

---

# Быстрый старт

## Вариант 1 — установка на Ubuntu/Debian

Для production-подобной установки проще всего использовать `install.sh`.

```bash
git clone https://github.com/Sivolen/LinkVision.git /opt/LinkVision
cd /opt/LinkVision
sudo ./install.sh
```

Установщик:

1. проверит Python;
2. установит системные зависимости;
3. создаст `venv`;
4. установит `requirements.txt`;
5. создаст `.env` со случайным `SECRET_KEY`, если его ещё нет;
6. применит SQLite-миграции;
7. создаст каталоги uploads и logs;
8. по запросу установит и запустит systemd-сервис.

Порт production-сервиса по умолчанию — **8005**.

Его можно изменить:

```bash
sudo LINKVISION_PORT=9000 ./install.sh
```

### HTTPS / reverse proxy

Standalone-установка по умолчанию рассчитана на прямой HTTP-доступ. Для production за HTTPS reverse proxy перед установкой можно указать:

```bash
sudo LINKVISION_HTTPS=true LINKVISION_BEHIND_PROXY=true ./install.sh
```

Если `.env` уже существует, установщик **не перезаписывает его настройки**.

---

# Первый запуск

При первом реальном запуске, если администратор ещё не существует, приложение создаёт пользователя:

```text
admin
```

Пароль генерируется случайно и выводится один раз в консоль/журнал запуска:

```text
============================================================
  Temporary admin password: <generated-password>
============================================================
```

После первого входа необходимо установить новый пароль.

Для systemd:

```bash
sudo journalctl -u linkvision.service -n 100 | grep -A2 "Temporary admin password"
```

**Не публикуйте этот пароль и не сохраняйте его в README, issue или чате.**

---

# Ручная установка

## 1. Клонирование

```bash
git clone https://github.com/Sivolen/LinkVision.git /opt/LinkVision
cd /opt/LinkVision
```

## 2. Python

Требуется **Python 3.10+**.

```bash
python3 --version
python3 -m venv venv
source venv/bin/activate
```

## 3. Зависимости

```bash
pip install -r requirements.txt
```

## 4. Конфигурация

Пример переменных находится в `.env.example`.

Минимальный production-вариант:

```dotenv
SECRET_KEY=сгенерированный-длинный-случайный-ключ
SESSION_COOKIE_SECURE=True
BEHIND_PROXY=True
LOG_LEVEL=INFO
```

`SESSION_COOKIE_SECURE=True` следует использовать только когда пользователь действительно работает через HTTPS.

`BEHIND_PROXY=True` предназначен для конфигурации за доверенным reverse proxy, передающим `X-Forwarded-*`.

`.env` создаётся автоматически при первом запуске, если его нет. Установщик создаёт его заранее, чтобы настройки уже применялись к первой миграции и первому запуску.

### Основные переменные

| Переменная | Назначение | Значение по умолчанию |
|---|---|---|
| `SECRET_KEY` | Подпись сессий и CSRF | генерируется автоматически |
| `DATABASE_URL` | Внешняя БД | SQLite |
| `LOG_LEVEL` | Уровень логирования | `INFO` |
| `FLASK_DEBUG` | Flask debug | `False` |
| `SESSION_COOKIE_SECURE` | Secure cookies | `False` |
| `BEHIND_PROXY` | Доверие к `X-Forwarded-*` | `False` |

---

# База данных и миграции

## SQLite

SQLite используется по умолчанию.

Единая точка входа для структурных миграций:

```bash
./apply_migrations.sh
```

Приложение **не должно самостоятельно изменять существующую схему при старте**.

Миграционный механизм проверяет фактическую структуру БД и после успешного применения изменений обновляет маркер совместимости схемы.

Перед миграцией существующей SQLite-базы создаётся резервная копия вида:

```text
webnetmap.db.migration_backup_YYYYMMDD_HHMMSS
```

Повторный запуск миграции должен быть идемпотентным: уже применённые изменения повторно создавать не нужно.

### Что покрывает текущая схема

В частности:

- локаль пользователя;
- папки и положение карт;
- права папок и карт;
- вложенные группы;
- множественные IP;
- историю доступности;
- историю качества;
- профили качества;
- настройки мониторинга;
- необходимые индексы.

## PostgreSQL

PostgreSQL может использоваться через `DATABASE_URL`.

Для **новой пустой** PostgreSQL-базы приложение может создать таблицы из текущей ORM-модели.

Для существующей PostgreSQL-базы приложение не выполняет автоматическое изменение схемы. Если схема несовместима, запуск останавливается с ошибкой вместо попытки «тихо» достроить БД.

Перед обновлением существующей PostgreSQL-базы необходим отдельный проверенный процесс миграции для вашей схемы.

---

# Production через systemd

После установки сервис обычно выглядит так:

```text
Browser
   │
   │ HTTPS
   ▼
Nginx / другой reverse proxy
   │
   │ HTTP + WebSocket
   ▼
Gunicorn + Eventlet
   │
   ▼
LinkVision (Flask)
   │
   ├── SQLite / PostgreSQL
   ├── ICMP monitor
   └── Socket.IO
```

Systemd-сервис запускает Gunicorn с одним worker:

```text
gunicorn -k eventlet -w 1 -b 0.0.0.0:8005 wsgi:app
```

Проверка:

```bash
sudo systemctl status linkvision.service
```

Логи:

```bash
sudo journalctl -u linkvision.service -f
```

### Почему один worker

Фоновый мониторинг и realtime-события рассчитаны на текущую однопроцессную конфигурацию. При увеличении числа web workers необходимо отдельно продумать общий backend для rate limiting и согласование фонового мониторинга между процессами.

---

# Обновление установленной версии

Для SQLite рекомендуемый порядок:

```bash
sudo systemctl stop linkvision.service
cd /opt/LinkVision
sudo git pull
sudo /opt/LinkVision/venv/bin/pip install -r requirements.txt
sudo ./apply_migrations.sh
sudo systemctl start linkvision.service
```

После запуска:

```bash
sudo systemctl status linkvision.service
sudo journalctl -u linkvision.service -n 100
```

**Не запускайте приложение до успешного завершения миграции**, если обновление требует изменения схемы.

---

# Frontend

Исходный JavaScript находится в `static/js/`.

Production загружает только собранные файлы:

```text
static/js/dist/*.min.js
```

Исходники не подключаются напрямую в production-шаблоны.

## Сборка

Требуется Node.js/npm.

```bash
npm install
npm run build
```

## Watcher

Для разработки:

```bash
npm run watch
```

Watcher следит за исходниками и игнорирует уже сгенерированный каталог:

```text
static/js/dist/**
```

Поэтому схема разработки остаётся простой:

```text
static/js/src + static/js/*.js
            │
            ▼
          esbuild
            │
            ▼
static/js/dist/*.min.js
```

**Редактировать следует исходники. `dist` вручную не правится.**

---

# Мониторинг: основные настройки

Администратор может изменить настройки мониторинга в административном разделе.

Основные параметры текущей версии:

| Параметр | По умолчанию | Назначение |
|---|---:|---|
| `ping_count` | `4` | ICMP-пакетов за проверку |
| `ping_interval` | `10` сек | интервал цикла |
| `ping_timeout` | `1.0` сек | timeout |
| `history_retention_days` | `7` | хранение истории UP/DOWN и агрегатов |
| `monitor_max_workers` | `150` | размер пула мониторинга |

Максимум `monitor_max_workers` — **300**.

При изменении размера пула мониторинга применяется hot-resize на границе цикла, без принудительного разделения устройств на батчи по 50.

---

# Логи

Основные файловые логи создаются в:

```text
logs/
```

Примеры:

```bash
tail -f logs/app.log
tail -f logs/auth.log
tail -f logs/api.log
du -sh logs/*
```

При systemd основной источник production-логов — journal:

```bash
sudo journalctl -u linkvision.service -f
```

---

# Тестирование

Backend:

```bash
python -m pytest tests/ -v
```

Frontend integrity:

```bash
npm run test:frontend
```

JavaScript-тесты:

```bash
npm run test:js
```

Общий запуск:

```bash
./run_tests.sh all
```

С покрытием Python-кода:

```bash
./run_tests.sh all true
```

---

# Структура проекта

```text
LinkVision/
├── app.py                    # создание Flask-приложения, Socket.IO, startup checks
├── wsgi.py                   # WSGI entrypoint для Gunicorn
├── config.py                 # конфигурация и версия
├── extensions.py             # Flask/SQLAlchemy/Login/Socket.IO/Babel
├── models.py                 # ORM-модели
├── forms.py                  # WTForms
├── requirements.txt
├── package.json
├── apply_migrations.sh       # единая точка SQLite-миграций
├── migrate_db.py             # реализация миграций
├── install.sh                # Ubuntu/Debian installer
├── linkvision.service        # systemd-шаблон
├── .env.example
│
├── blueprints/
│   ├── auth.py               # login/register/logout/password
│   ├── admin.py              # административный раздел
│   ├── main.py               # dashboard/map pages
│   └── api/                  # REST API
│
├── services/
│   ├── monitor.py            # ICMP monitoring
│   ├── quality_service.py    # quality profiles/classification
│   ├── map_service.py        # карты и сериализация
│   ├── map_import_export_service.py
│   ├── folder_service.py     # папки
│   ├── group_service.py      # вложенные группы
│   ├── permissions.py        # проверка доступа
│   ├── security_service.py  # rate limiting
│   └── db/                   # DB repositories/schema helpers
│
├── static/
│   ├── css/
│   └── js/
│       ├── base.js
│       ├── common.js
│       ├── src/               # исходники модулей
│       └── dist/              # production bundles
│
├── templates/                 # Jinja-шаблоны
├── translations/              # ru/en
├── tests/                     # backend/frontend tests
├── screenshots/               # screenshots для документации
└── logs/                      # runtime logs
```

---

# Типовые проблемы

### После обновления приложение сообщает о несовместимой схеме

Не пытайтесь запускать приложение снова и не выполняйте случайный `ALTER TABLE` вручную.

Для SQLite:

```bash
sudo systemctl stop linkvision.service
cd /opt/LinkVision
sudo ./apply_migrations.sh
sudo systemctl start linkvision.service
```

Если миграция завершилась ошибкой, сначала разберите её причину или восстановите резервную копию.

### После изменения JavaScript ничего не изменилось

Production использует `dist`-бандлы. Выполните:

```bash
npm run build
```

В режиме разработки используйте:

```bash
npm run watch
```

### После включения HTTPS не работает авторизация

Проверьте `.env`:

```dotenv
SESSION_COOKIE_SECURE=True
BEHIND_PROXY=True
```

И убедитесь, что reverse proxy корректно передаёт `X-Forwarded-Proto`.

### WebSocket не подключается через reverse proxy

Проверьте, что proxy разрешает Upgrade/Connection для WebSocket и что наружный HTTPS соответствует внутреннему `ws/wss` соединению.

### Нужно посмотреть временный пароль admin

При systemd:

```bash
sudo journalctl -u linkvision.service -n 100 | grep -A2 "Temporary admin password"
```

Если администратор уже существует, новый временный пароль не генерируется.

---

# Важные правила эксплуатации

1. **Делайте резервную копию БД перед крупным обновлением.**
2. Не храните `.env` в публичном репозитории.
3. Не используйте debug-режим на production-сервере.
4. Для публичного доступа используйте HTTPS.
5. Не редактируйте `static/js/dist/*.min.js` вручную.
6. Не изменяйте существующую схему БД ad-hoc SQL-командами, если для неё есть поддерживаемая миграция.
7. После обновления проверяйте systemd journal и доступность WebSocket.

---

# Технологии

**Backend**

- Python 3.10+
- Flask
- Flask-SQLAlchemy
- Flask-Login
- Flask-SocketIO
- Flask-Babel
- Flask-WTF
- SQLAlchemy
- Eventlet
- Gunicorn
- ping3

**Frontend**

- Bootstrap 5
- Font Awesome
- Cytoscape.js
- Socket.IO client
- ES6 modules
- esbuild

**Хранилище**

- SQLite — стандартный вариант;
- PostgreSQL — для внешней БД при наличии отдельного процесса миграции существующей схемы.

---

# Версия

Текущая версия проекта:

```text
2.2.2
```

Крупные изменения текущей ветки охватывают мониторинг, качество ICMP, папки и права доступа, вложенные группы, импорт/экспорт, WebSocket-синхронизацию и усиление web-безопасности.

Подробный список изменений находится в `Release Notes`.

---

# Лицензия

MIT — см. файл `LICENSE`.

---

**LinkVision — наглядная карта сети, мониторинг доступности и контроль состояния инфраструктуры в одном интерфейсе.**
