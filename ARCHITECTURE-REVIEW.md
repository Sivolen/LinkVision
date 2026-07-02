# LinkVision (ver2) — архитектурный обзор

Оценка состояния проекта, что сделано хорошо, где реальные проблемы и как их
чинить. Все находки проверены по коду ветки `ver2`; выводы, которые при проверке
оказались ложными, вынесены отдельно, чтобы не тратить на них время.

**Общая оценка: ~6.5/10** — крепкий middle-level. Настоящая слоистая архитектура,
права доступа, аудит, тесты, продуманный мониторинг. Пригоден для продакшена на
10–100 пользователей. Для масштабирования и «спокойного сна» нужны правки ниже.

---

## 0. Что НЕ является проблемой (проверено, не трогать)

Эти пункты часто выглядят подозрительно, но по факту сделаны корректно:

- **Скачивание бэкапа БД защищено.** `download_backup` помечен только `@login_required`,
  но у всего `admin_bp` есть `before_request` (`blueprints/admin.py:25`), режущий всех
  кроме `is_admin`. Дыры нет.
- **CSRF-exempt на API не опасен.** `WTF_CSRF` отключён для `api_bp` (`app.py:84`), но
  `SESSION_COOKIE_SAMESITE="Lax"` + `SESSION_COOKIE_HTTPONLY=True` (`config.py:26-27`)
  блокируют межсайтовые запросы с кукой.
- **SECRET_KEY** генерируется автоматически (`ensure_env_file()` в `app.py`) + есть
  предупреждение в prod (`config.py:12-21`).
- **Миграции на Alembic подключены** (`Migrate(app, db)`, `app.py:76`). Скрипты
  `migrate_db.py`/`fix_db.py` — довесок, а не замена.

---

## 1. Что сделано хорошо

- **Слоистость** blueprint → service → repository → model выдержана: роуты тонкие,
  бизнес-логика в сервисах, SQL в `services/db/*`.
- **Права доступа** гранулярные (`permissions.py`: `can_view_map`, `can_edit_map`,
  декораторы `@require_map_access`/`@require_device_edit`) + полный **аудит**
  (`audit_service.py`).
- **Модель данных** нормализована (IP вынесены в `DeviceIP`), индексы на FK и на
  часто фильтруемых полях присутствуют.
- **Мониторинг** (`monitor.py`) — пул потоков, батчи по 50, дебаунс, история статусов.
- **Фронтенд модульный** — 18 модулей карты с чёткими границами, `esbuild`-бандлы,
  batch-оптимизации Cytoscape.

---

## 🔴 ПРИОРИТЕТ 1 — срочно (безопасность)

### 1.1. Сокеты без авторизации — утечка данных в обход прав

Файл: `app.py:129-186`. `join_room` и `request_status` **не проверяют право на карту**,
а `extensions.py:10` разрешает `cors_allowed_origins="*"`. Любой аутентифицированный
пользователь может подписаться на комнату `map_<чужой_id>` и получать позиции, статусы
и все точечные события чужой карты — при том, что HTTP-доступ к ней закрыт системой прав.

**Было** (`app.py:129-132`):
```python
@socketio.on("join_room")
def handle_join_room(room):
    join_room(room)
    app_logger.info(f"✅ Клиент присоединился к комнате {room}")
```

**Стало** — проверять `can_view_map` перед входом в комнату:
```python
from flask_login import current_user
from services.permissions import can_view_map

@socketio.on("join_room")
def handle_join_room(room):
    if not current_user.is_authenticated:
        return  # или raise ConnectionRefusedError
    # комнаты вида "map_<id>"
    try:
        map_id = int(str(room).split("_", 1)[1])
    except (IndexError, ValueError):
        app_logger.warning(f"Отклонён вход в комнату с некорректным именем: {room}")
        return
    if not can_view_map(map_id):
        app_logger.warning(
            f"Пользователь {current_user.id} отклонён при входе в {room}"
        )
        return
    join_room(room)
    app_logger.info(f"✅ Клиент присоединился к комнате {room}")
```

Аналогично закрыть `request_status` (`app.py:174-186`):
```python
@socketio.on("request_status")
def handle_request_status(data):
    map_id = data.get("map_id")
    if not map_id or not current_user.is_authenticated or not can_view_map(map_id):
        return
    from models import Device
    with app.app_context():
        devices = Device.query.filter_by(map_id=map_id, monitoring_enabled=True).all()
        statuses = [{"id": d.id, "status": d.status} for d in devices]
        socketio.emit("device_status_batch", statuses, room=f"map_{map_id}")
```

> Также ограничить CORS до реального домена вместо `"*"` в `extensions.py`
> (`cors_allowed_origins=["https://ваш-домен"]`).

---

### 1.2. Дефолтный пароль администратора `"Admin"`

Файл: `app.py:100-110`. При инициализации пустой БД создаётся админ с предсказуемым
паролем. Рядом уже есть закомментированный правильный вариант.

**Было:**
```python
        if not User.query.filter_by(is_admin=True).first():
            import secrets

            admin = User(username="admin", is_admin=True)
            # default_password = secrets.token_urlsafe(8)  # случайный пароль
            default_password = "Admin"
            admin.set_password(default_password)
            db.session.add(admin)
            db.session.commit()
            app_logger.info(f"✅ Создан администратор: admin / {default_password}")
```

**Стало** — генерировать пароль и требовать смены при первом входе:
```python
        if not User.query.filter_by(is_admin=True).first():
            import secrets

            admin = User(username="admin", is_admin=True)
            default_password = secrets.token_urlsafe(16)
            admin.set_password(default_password)
            db.session.add(admin)
            db.session.commit()
            # Пароль показывается ОДИН раз в логе — далее его нужно сменить
            app_logger.warning(
                f"✅ Создан администратор admin. Временный пароль: {default_password}"
            )
```

> Опционально: флаг `must_change_password` в модели `User` и редирект на смену пароля.

---

## 🟠 ПРИОРИТЕТ 2 — важно (масштабирование и структура)

### 2.1. Реалтайм не масштабируется за один воркер

Файл: `extensions.py:9-16`. `async_mode="threading"` без message queue: при
`gunicorn -w 2+` события, отправленные из одного воркера, **не дойдут** до клиентов,
подключённых к другому. Плюс SQLite при конкурентной записи (монитор + веб) даёт
блокировки.

Два пути — выбрать по нагрузке:

**Вариант A (много пользователей):** Redis как message queue + PostgreSQL.
```python
# extensions.py
import os
socketio = SocketIO(
    cors_allowed_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    async_mode="threading",
    message_queue=os.environ.get("REDIS_URL"),   # напр. redis://localhost:6379/0
    ping_interval=30,
    ping_timeout=100,
    max_http_buffer_size=100_000_000,
)
```
БД — через `DATABASE_URL` (уже поддержано в `config.py:31`).

**Вариант B (небольшая установка):** ничего не менять, но **зафиксировать один воркер**
и задокументировать это в README/`linkvision.service`:
```
gunicorn -k eventlet -w 1 wsgi:application    # ровно один воркер
```

---

### 2.2. God-файлы: `api.py` (1316 строк) и `map_service.py` (953)

Слишком много ответственности в одном модуле — тяжело читать, тестировать и мержить.

**`blueprints/api.py`** → разбить на под-blueprint'ы по домену. Пример каркаса:
```python
# blueprints/api/__init__.py
from flask import Blueprint
api_bp = Blueprint("api", __name__, url_prefix="/api")

from . import devices, links, groups, shapes, permissions, maps  # noqa: E402
```
```python
# blueprints/api/devices.py
from . import api_bp
from services import device_service
from services.permissions import require_device_edit

@api_bp.route("/device/<int:device_id>", methods=["PUT"])
@require_device_edit
def update_device(device_id):
    ...
```
Цель: каждый файл ≤300 строк, один домен = один файл.

**`services/map_service.py`** → выделить `link_service.py`, `group_service.py`,
`shape_service.py`, а также `map_import_export_service.py`. В `map_service` оставить
только CRUD карт и сборку элементов.

> Делать инкрементально: сначала вынести один домен (напр. shapes), убедиться, что
> тесты зелёные, затем следующий. Не переписывать всё разом.

---

### 2.3. Прямой `db.session` в роутах вместо сервисов

Местами роут сам делает `db.session.add/commit` (напр. операции с `MapPermission` в
`api.py`, `last_map_id` в `main.py`), минуя сервисный слой. Это нарушает слоистость и
размазывает транзакции.

**Было** (пример, роут):
```python
    perm = MapPermission(map_id=map_id, user_id=user_id, role=role)
    db.session.add(perm)
    db.session.commit()
```

**Стало** — вынести в `services/permission_service.py`:
```python
# services/permission_service.py
def grant_map_permission(map_id, user_id, role):
    perm = MapPermission(map_id=map_id, user_id=user_id, role=role)
    db.session.add(perm)
    db.session.commit()
    return perm
```
```python
    # в роуте
    from services import permission_service
    permission_service.grant_map_permission(map_id, user_id, role)
```

---

### 2.4. Утечка деталей ошибок в API

Часть роутов возвращает `str(e)` клиенту — это раскрывает внутренние сообщения/структуру.

**Было** (паттерн в `api.py`):
```python
    except Exception as e:
        api_logger.error(f"Error updating position: {e}")
        return jsonify({"error": str(e)}), 500
```

**Стало** — логировать подробности на сервере, клиенту отдавать generic + добавить
глобальный обработчик:
```python
    except Exception:
        api_logger.exception("Error updating position")
        return jsonify({"error": "Внутренняя ошибка сервера"}), 500
```
```python
# app.py — единый обработчик для необработанных исключений в API
@app.errorhandler(Exception)
def handle_unexpected(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    app_logger.exception("Unhandled exception")
    return jsonify({"error": "Внутренняя ошибка сервера"}), 500
```

---

## 🟠 ПРИОРИТЕТ 2 — фронтенд

### 2.5. Дублирование: единый HTTP-слой и один `showToast`

Паттерн `fetch` + заголовки + CSRF копируется в ~15 местах, `getCsrfToken` определён в
3 файлах, а `showToast` существует в **двух несовместимых** реализациях
(`base.js` и `modal/ui.js`). При доработке одной вторая отстаёт.

Создать `static/js/src/utils/http.js`:
```javascript
// utils/http.js
import { getCsrfToken } from './csrf.js';

async function request(method, url, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (res.status === 401) { window.location.href = '/auth/login'; throw new Error('unauthorized'); }
    if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : null;
}

export const http = {
    get:  (url)        => request('GET', url),
    post: (url, body)  => request('POST', url, body),
    put:  (url, body)  => request('PUT', url, body),
    del:  (url)        => request('DELETE', url),
};
```
Пример использования вместо ручного fetch:
```javascript
// было: fetch(`/api/device/${id}/position`, { method:'PUT', headers:{...}, body:... })
import { http } from '../utils/http.js';
await http.put(`/api/device/${id}/position`, { x, y });
```
`getCsrfToken` — вынести в один `utils/csrf.js` и импортировать. `showToast` — оставить
одну реализацию (напр. в `base.js`), модалки импортируют её, а не дублируют.

---

### 2.6. Глобальное состояние и костыль `skipNextMapUpdate`

Состояние размазано по `window.*` (`cy`, `currentMapId`, `saveState`,
`setSkipNextMapUpdate`…). Флаг `skipNextMapUpdate` сбрасывается по `setTimeout` — если
запрос завис дольше таймера, флаг «отпустит» рано и придёт лишнее обновление.

Минимальный шаг — счётчик незавершённых операций вместо булева флага:
```javascript
// state.js
let pendingSelfUpdates = 0;
export const isSelfUpdating = () => pendingSelfUpdates > 0;
export function beginSelfUpdate() { pendingSelfUpdates++; }
export function endSelfUpdate() { pendingSelfUpdates = Math.max(0, pendingSelfUpdates - 1); }
```
```javascript
// на отправке
beginSelfUpdate();
try { await http.put(`/api/device/${id}/position`, { x, y }); }
finally { endSelfUpdate(); }
```
Обработчик `map_updated` проверяет `isSelfUpdating()` вместо `skipNextMapUpdate`. Так
флаг живёт ровно столько, сколько реально длятся запросы, без гонок по таймеру.

---

### 2.7. Динамические import для синхронных функций

Файл: `static/js/src/map/index.js` (конец). Обёртки вида
`window.reloadMapElements = () => import('./elements.js').then(m => m.reloadMapElements())`
добавляют лишнюю асинхронность и глотают ошибки — esbuild и так всё бандлит.

**Было:**
```javascript
window.reloadMapElements = (force = false) => import('./elements.js').then(m => m.reloadMapElements(force));
window.addDeviceToGraph = (d) => import('./elements.js').then(m => m.addDeviceToGraph(d));
```
**Стало** — статический импорт сверху + прямой реэкспорт:
```javascript
import { reloadMapElements, addDeviceToGraph } from './elements.js';
// ...
window.reloadMapElements = reloadMapElements;
window.addDeviceToGraph = addDeviceToGraph;
```

---

## 🟡 ПРИОРИТЕТ 3 — гигиена и качество

### 3.1. Тесты на критичный путь — права доступа

Сейчас покрыты только валидаторы. Самое ценное, что стоит добавить, — тесты
`permissions.py` (кто что видит/редактирует) и авторизации сокетов.

Пример (pytest, с уже существующими фикстурами из `tests/conftest.py`):
```python
def test_operator_cannot_view_foreign_map(client, operator_user, foreign_map):
    with client.session_transaction() as s:
        s["_user_id"] = str(operator_user.id)
    from services.permissions import can_view_map
    assert can_view_map(foreign_map.id) is False

def test_editor_can_edit_shared_map(app, editor_user, shared_map):
    ...
```

### 3.2. Удалить мёртвый код и артефакты

- `services/monitor_old.py` — старый монитор, не используется.
- `static/js/*_old` (`map.js_old`, `modal.js_old`, `cytoscape.min.js_old`, `socket.io.js_old`).
- `vite.config.js` — не используется (сборка на esbuild), да ещё ссылается на
  несуществующий `static/js/src/main.js`. Удалить, чтобы не путал.
- Закомментированные блоки в `models.py`, `core.js`, `undoRedo.js`.

### 3.3. `dist/*.min.js` в git → в `.gitignore` + сборка в CI

Закоммиченные бандлы легко устаревают (правишь `src`, забываешь `npm run build`).
Убрать из репозитория, добавить в `.gitignore`, а сборку выполнять при деплое:
```
# .gitignore
static/js/dist/
```
```
# шаг деплоя / CI
npm ci && npm run build
```
> Компромисс, если деплой без Node: оставить `dist` в git, но добавить pre-commit
> hook, который пересобирает бандлы. Главное — не держать src и dist рассинхронизированными.

### 3.4. Инлайн-JS в шаблонах

`window.isOperator`, `window.currentMapId` и инициализация `initMap` заданы прямо в
`templates/base.html` / `map_view.html`, местами продублированы. Заменить на
`data-*`-атрибуты + один init-скрипт:
```html
<body data-map-id="{{ map.id if map else '' }}"
      data-is-operator="{{ 'true' if is_operator else 'false' }}">
```
```javascript
// app-init.js
const { mapId, isOperator } = document.body.dataset;
window.isOperator = isOperator === 'true';
if (mapId) initMap(Number(mapId));
```

---

## Чек-лист внедрения

**🔴 Срочно (безопасность):**
- [x] 1.1 Авторизация в `join_room` / `request_status` (`can_view_map`) + сузить CORS
- [x] 1.2 Убрать дефолтный пароль `"Admin"` → `secrets.token_urlsafe(16)`

**🟠 Важно:**
- [x] 2.1 Решить по масштабу: Redis+PostgreSQL ИЛИ зафиксировать `-w 1` ✅ (зафиксировано)
- [x] 2.2 Разбить `api.py` и `map_service.py` (инкрементально, по домену)
- [x] 2.3 Вынести прямые `db.session` из роутов в сервисы
- [x] 2.4 Не отдавать `str(e)` клиенту + глобальный errorhandler
- [x] 2.5 Единый `http.js` + один `getCsrfToken` + один `showToast`
- [x] 2.6 Заменить `skipNextMapUpdate` на счётчик операций
- [x] 2.7 Статические import вместо динамических

**🟡 Гигиена:**
- [ ] 3.1 Тесты на `permissions` и сокет-авторизацию
- [x] 3.2 Удалить `*_old`, `vite.config.js`, закомментированный код
- [x] 3.3 `dist/` в `.gitignore` + сборка в CI
- [x] 3.4 Инлайн-JS в шаблонах → `data-*` + init-скрипт

---

## Итог

Архитектура здоровая, «кости» правильные. Единственное по-настоящему срочное — **авторизация
сокетов** (пункт 1.1): без неё вся система прав обходится через WebSocket. Остальное —
управляемый техдолг, который можно закрывать итерациями, не переписывая проект.
