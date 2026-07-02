# LinkVision (ver2) — план оптимизации

Документ описывает **что и где менять** для устранения подтверждённых узких мест
производительности. Каждый пункт: путь к файлу, строки, в чём проблема, блоки
**Было / Стало**.

> Все находки проверены по коду ветки `ver2`. Номера строк могут немного сместиться
> после правок — ориентируйтесь на содержимое фрагментов «Было».

---

## 0. Что уже хорошо (НЕ трогать)

- **Горячий путь `get_map_elements`** (`services/map_service.py:321`) уже использует
  `joinedload(Device.type, Device.ips)` + `func.count` для счётчика устройств в группах
  + TTL-кэш. Это главный сериализатор карты — он оптимален.
- **Индексы БД** покрыты: `device(map_id, status, group_id)`, `link(map_id, source, target)`,
  `device_history`, `audit_log`.
- **Выделение** переведено на нативное Cytoscape (`node:selected`) + debounce кнопки
  массового редактирования.
- **Мониторинг** работает в `ThreadPoolExecutor`, батчами по 50, с TTL-кэшем настроек.

После любой правки JS — пересобрать бандл:

```bash
npm run build:map      # esbuild → static/js/dist/map.min.js
# или полностью: npm run build
```

Шаблон грузит `static/js/dist/map.min.js`, правки в `src/` без пересборки не подхватятся.

---

## ПРИОРИТЕТ 1 — самый ощутимый эффект

### 1.1. `services/monitor.py` — N+1, повторные запросы и emit по одному

Файл: `services/monitor.py`. Фоновый цикл крутится постоянно, поэтому его стоимость
самая важная. Здесь сразу несколько проблем в одном цикле.

**Проблема A — N+1 на `dev.ips`** (строки ~132 и ~142): устройства грузятся без
eager-load связанных IP, затем `dev.ips` дёргается в цикле → отдельный запрос на каждое
устройство.

**Было** (строка ~131):
```python
            with app_instance.app_context():
                devices = Device.query.filter_by(monitoring_enabled=True).all()
```

**Стало:**
```python
            with app_instance.app_context():
                devices = (
                    Device.query.options(joinedload(Device.ips))
                    .filter_by(monitoring_enabled=True)
                    .all()
                )
```

Добавить импорт вверху файла:
```python
from sqlalchemy.orm import joinedload
```

---

**Проблема B — `app_context()` открывается на КАЖДОЙ итерации + повторные `Device.query.get`**
(строки ~233–270). Сейчас один и тот же набор устройств запрашивается из БД дважды,
а контекст приложения создаётся внутри цикла по результатам.

**Было** (строки ~229–270):
```python
            # ---- ОБРАБОТКА ИЗМЕНЕНИЙ ----
            devices_to_update = []
            history_entries = []
            current_time = time.time()
            with _lock:
                for dev_id, new_status in results:
                    last_time = last_emit_time.get(dev_id, 0)
                    if current_time - last_time < 0.5:
                        continue

                    with app_instance.app_context():
                        device = Device.query.get(dev_id)
                        if not device:
                            continue

                        if device.status != new_status:
                            devices_to_update.append((device, new_status))
                            history_entries.append(
                                DeviceHistory(
                                    device_id=device.id,
                                    old_status=device.status,
                                    new_status=new_status,
                                )
                            )
                            last_emit_time[dev_id] = current_time
                            monitor_logger.info(
                                f"Device {dev_id} status change: {device.status} -> {new_status}"
                            )

            if devices_to_update:
                with app_instance.app_context():
                    devices_to_save = []
                    for device, new_status in devices_to_update:
                        dev = Device.query.get(device.id)
                        if dev:
                            dev.status = new_status
                            dev.last_check = datetime.datetime.now()
                            devices_to_save.append(dev)

                    db.session.bulk_save_objects(devices_to_save)
                    db.session.add_all(history_entries)
                    db.session.commit()

                    batch_emits = []
                    for device, new_status in devices_to_update:
                        room_name = f"map_{device.map_id}"
                        batch_emits.append(
                            {
                                "room": room_name,
                                "data": {
                                    "id": device.id,
                                    "status": new_status,
                                    "map_id": device.map_id,
                                },
                            }
                        )
                        monitor_logger.info(
                            f"[{new_status.upper()}] Sent: id={device.id}, status={new_status}, room={room_name}"
                        )

                    for emit_data in batch_emits:
                        socketio.emit(
                            "device_status", emit_data["data"], room=emit_data["room"]
                        )
            else:
                monitor_logger.debug("No status changes this cycle")
```

**Стало** — один контекст, один проход, словарь вместо повторных `get`, и emit
**батчами по комнатам** (`device_status_batch` уже умеет фронтенд):
```python
            # ---- ОБРАБОТКА ИЗМЕНЕНИЙ ----
            current_time = time.time()
            # Сгруппируем emit по комнатам карт: room -> список статусов
            emits_by_room = {}

            with _lock, app_instance.app_context():
                # Одним запросом тянем все затронутые устройства
                changed_ids = [
                    dev_id for dev_id, _ in results
                    if current_time - last_emit_time.get(dev_id, 0) >= 0.5
                ]
                if changed_ids:
                    devices_by_id = {
                        d.id: d
                        for d in Device.query.filter(Device.id.in_(changed_ids)).all()
                    }

                    history_entries = []
                    for dev_id, new_status in results:
                        if current_time - last_emit_time.get(dev_id, 0) < 0.5:
                            continue
                        device = devices_by_id.get(dev_id)
                        if not device or device.status == new_status:
                            continue

                        history_entries.append(
                            DeviceHistory(
                                device_id=device.id,
                                old_status=device.status,
                                new_status=new_status,
                            )
                        )
                        device.status = new_status
                        device.last_check = datetime.datetime.now()
                        last_emit_time[dev_id] = current_time

                        room = f"map_{device.map_id}"
                        emits_by_room.setdefault(room, []).append(
                            {"id": device.id, "status": new_status, "map_id": device.map_id}
                        )
                        monitor_logger.info(
                            f"Device {dev_id} status change -> {new_status}"
                        )

                    if history_entries:
                        db.session.add_all(history_entries)
                        db.session.commit()

            # Emit ОДНИМ сообщением на комнату
            for room, statuses in emits_by_room.items():
                socketio.emit("device_status_batch", statuses, room=room)

            if not emits_by_room:
                monitor_logger.debug("No status changes this cycle")
```

> Примечание: `device` берётся из сессии текущего контекста, статус меняется прямо на
> объекте, `commit()` сохраняет — `bulk_save_objects` больше не нужен (он для НОВЫХ
> объектов, а тут уже персистентные). Фронтенд-обработчик `device_status_batch` уже
> существует в `static/js/src/map/index.js`.

---

### 1.2. `static/js/src/map/undoRedo.js` — N отдельных fetch при undo/redo

Файл: `static/js/src/map/undoRedo.js`, функция `syncPositionsToServer` (строки ~72–106).
Сейчас на каждый узел уходит отдельный HTTP-запрос (50 узлов = 50 запросов). Есть
bulk-эндпоинт `/api/devices/positions` (его уже использует `layout.js`).

**Было** (строки ~84–106):
```javascript
        window.setSkipNextMapUpdate();
        const promises = [];
        for (const upd of deviceUpdates) {
            promises.push(fetch(`/api/device/${upd.id}/position`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ x: upd.x, y: upd.y })
            }));
        }
        for (const upd of shapeUpdates) {
            const shapeId = upd.id.replace('shape_', '');
            promises.push(fetch(`/api/shape/${shapeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ x: upd.x, y: upd.y })
            }));
        }
        Promise.all(promises)
            .catch(err => console.error('Sync positions error:', err))
            .finally(() => {
                setTimeout(() => window.clearSkipNextMapUpdate(), 500);
            });
```

**Стало** — один bulk-запрос на все устройства, фигуры остаются отдельными:
```javascript
        window.setSkipNextMapUpdate();
        const promises = [];

        // Все устройства — одним запросом
        if (deviceUpdates.length) {
            promises.push(fetch('/api/devices/positions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify(deviceUpdates.map(u => ({ id: u.id, x: u.x, y: u.y })))
            }));
        }

        // Фигуры (нет bulk-эндпоинта) — по одной
        for (const upd of shapeUpdates) {
            const shapeId = upd.id.replace('shape_', '');
            promises.push(fetch(`/api/shape/${shapeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ x: upd.x, y: upd.y })
            }));
        }

        Promise.allSettled(promises)
            .finally(() => {
                setTimeout(() => window.clearSkipNextMapUpdate(), 500);
            });
```

> Проверьте формат тела `/api/devices/positions` в `layout.js` и `blueprints/api.py` —
> используйте тот же (массив `{id, x, y}`).

---

## ПРИОРИТЕТ 2 — заметные улучшения

### 2.1. Двойной обработчик `cy.on('pan zoom')`

Один и тот же обработчик зарегистрирован дважды — в `core.js` и `viewport.js`.
`updateBackgroundTransform` / `enforcePanBounds` отрабатывают по два раза на каждый
пан/зум.

Файл: `static/js/src/map/core.js`, строки ~36–40.

**Было:**
```javascript
    // События
    cy.on('pan zoom', () => {
        updateBackgroundTransform();
        enforcePanBounds();
        saveViewportToServer();
    });
```

**Стало** — удалить этот блок целиком (он дублируется в `viewport.js:8`). После удаления
убрать из `core.js` неиспользуемые импорты `updateBackgroundTransform`, `enforcePanBounds`,
`saveViewportToServer`, если они больше нигде в файле не нужны.

> `viewport.js` (`initViewport`) уже делает всё то же самое, и `initViewport(cy)`
> вызывается в `index.js`. Достаточно одного обработчика.

---

### 2.2. `applyGrayStyle` — 6 раздельных `.style()` → один объект

Файл: `static/js/src/map/elements.js`, строки ~328–339. Каждый одиночный `.style()`
= отдельный пересчёт стиля. На карте с большим числом «выключенных из мониторинга»
устройств это умножается.

**Было:**
```javascript
export function applyGrayStyle(node) {
    if (!node || !node.length) return;
    node.style('border-color', '#6c757d');
    node.style('border-style', 'dotted');
    node.style('border-width', '3px');
    node.style('opacity', '0.7');
    node.style('overlay-opacity', '0');
    node.style('overlay-color', 'transparent');
    if (typeof window.removePulsingNode === 'function') {
        window.removePulsingNode(window.cy, node);
    }
}
```

**Стало:**
```javascript
export function applyGrayStyle(node) {
    if (!node || !node.length) return;
    node.style({
        'border-color': '#6c757d',
        'border-style': 'dotted',
        'border-width': '3px',
        'opacity': '0.7',
        'overlay-opacity': '0',
        'overlay-color': 'transparent'
    });
    if (typeof window.removePulsingNode === 'function') {
        window.removePulsingNode(window.cy, node);
    }
}
```

---

### 2.3. Применение стилей при загрузке — обернуть в `cy.batch()`

Файл: `static/js/src/map/elements.js`, строки ~164–167. После загрузки серый стиль и
пульсация применяются вне batch.

**Было:**
```javascript
            // Пакетное применение стилей
            monitoringOffNodes.forEach(node => applyGrayStyle(node));
            downNodes.forEach(node => addPulsingNode(cy, node, 'down'));
            partialNodes.forEach(node => addPulsingNode(cy, node, 'partial'));
```

**Стало:**
```javascript
            // Пакетное применение стилей — один проход рендера
            cy.batch(() => {
                monitoringOffNodes.forEach(node => applyGrayStyle(node));
                downNodes.forEach(node => addPulsingNode(cy, node, 'down'));
                partialNodes.forEach(node => addPulsingNode(cy, node, 'partial'));
            });
```

---

### 2.4. `pulse.js` — цикл анимации без batch

Файл: `static/js/src/map/pulse.js`, строки ~52–71. Интервал каждые 100 мс ставит
`overlay-opacity` каждому мигающему узлу отдельными вызовами.

**Было:**
```javascript
        pulseInterval = setInterval(() => {
            pulsePhase += pulseStep;
            if (pulsePhase > 1) pulsePhase -= 2;
            const opacity = minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));

            pulsingNodes.forEach((data, nodeId) => {
                const n = cy.getElementById(nodeId);
                if (n.length) {
                    n.style('overlay-opacity', opacity);
                } else {
                    clearTimeout(data.timeoutId);
                    pulsingNodes.delete(nodeId);
                }
            });

            if (pulsingNodes.size === 0 && pulseInterval) {
                clearInterval(pulseInterval);
                pulseInterval = null;
            }
        }, PULSE_INTERVAL_MS);
```

**Стало** — обернуть проход в `cy.batch()`:
```javascript
        pulseInterval = setInterval(() => {
            pulsePhase += pulseStep;
            if (pulsePhase > 1) pulsePhase -= 2;
            const opacity = minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));

            cy.batch(() => {
                pulsingNodes.forEach((data, nodeId) => {
                    const n = cy.getElementById(nodeId);
                    if (n.length) {
                        n.style('overlay-opacity', opacity);
                    } else {
                        clearTimeout(data.timeoutId);
                        pulsingNodes.delete(nodeId);
                    }
                });
            });

            if (pulsingNodes.size === 0 && pulseInterval) {
                clearInterval(pulseInterval);
                pulseInterval = null;
            }
        }, PULSE_INTERVAL_MS);
```

---

### 2.5. Подсветка при наведении — вернуть подавление во время рамки

Файл: `static/js/src/map/interactions.js`. При рефакторинге выделения убрали обработчики
`boxstart`/`boxend`, которые гасили hover-подсветку во время боксового выделения. Теперь
при протягивании рамки подсветка соседей срабатывает на каждом узле под курсором (а
`applyHighlight` читает `edge.style('line-color')` геттером — форсирует пересчёт).

**Добавить** в `initInteractions(cy)` (рядом с регистрацией `mouseover`/`mouseout`):
```javascript
    // Гасим hover-подсветку во время боксового выделения
    cy.on('boxstart', () => { window._isBulkSelecting = true; clearHighlight(); });
    cy.on('boxend',   () => { window._isBulkSelecting = false; });
```

**Изменить** обработчик наведения, чтобы он выходил во время рамки:
```javascript
    const handleMouseOver = function(evt) {
        if (window._isBulkSelecting) return;   // ← добавить
        const node = evt.target;
        if (node.data('isGroup') || node.data('isShape')) return;
        scheduleHighlight(node);
    };
```

---

### 2.6. `services/map_service.py` — N+1 в `export_map_data`

Файл: `services/map_service.py`, строка ~486. `map_obj.devices`, `dev.ips`, `map_obj.links`
грузятся лениво → N+1 при экспорте.

**Было:**
```python
    map_obj = Map.query.get_or_404(map_id)
```

**Стало:**
```python
    from sqlalchemy.orm import joinedload  # если не импортирован вверху файла
    map_obj = (
        Map.query.options(
            joinedload(Map.devices).joinedload(Device.ips),
            joinedload(Map.devices).joinedload(Device.type),
            joinedload(Map.links),
        ).get_or_404(map_id)
    )
```

---

### 2.7. `services/map_service.py` — `get_map_groups` считает в цикле

Файл: `services/map_service.py`, строка ~467. `g.devices.count()` = отдельный COUNT на
каждую группу. Рядом, в `get_map_elements`, это уже сделано правильно через `func.count`.

**Было:**
```python
    groups = Group.query.filter_by(map_id=map_id).all()
    result = [
        {
            "id": g.id,
            "name": g.name,
            "color": g.color,
            "font_size": g.font_size,
            "device_count": g.devices.count(),
        }
        for g in groups
    ]
```

**Стало** — один запрос со счётчиками:
```python
    from sqlalchemy import func
    groups = Group.query.filter_by(map_id=map_id).all()

    counts = dict(
        db.session.query(Device.group_id, func.count(Device.id))
        .filter(Device.map_id == map_id, Device.group_id.isnot(None))
        .group_by(Device.group_id)
        .all()
    )
    result = [
        {
            "id": g.id,
            "name": g.name,
            "color": g.color,
            "font_size": g.font_size,
            "device_count": counts.get(g.id, 0),
        }
        for g in groups
    ]
```

---

### 2.8. `services/map_service.py` — `import_map` запрашивает типы в цикле

Файл: `services/map_service.py`, строка ~779. `DeviceType.query.filter_by(name=...)`
вызывается внутри цикла по импортируемым устройствам.

**Было** (строки ~773–786):
```python
    # Импорт устройств
    device_id_map = {}
    for dev_data in data.get("devices", []):
        type_name = dev_data.get("type_name")

        if type_name:
            dtype = DeviceType.query.filter_by(name=type_name).first()
            if not dtype:
                dtype = DeviceType(name=type_name, icon_filename="")
                db.session.add(dtype)
                db.session.flush()
            type_id = dtype.id
        else:
            type_id = dev_data.get("type_id")
```

**Стало** — закэшировать все типы один раз до цикла:
```python
    # Кэш типов: name -> DeviceType (один запрос вместо N)
    type_cache = {dt.name: dt for dt in DeviceType.query.all()}

    # Импорт устройств
    device_id_map = {}
    for dev_data in data.get("devices", []):
        type_name = dev_data.get("type_name")

        if type_name:
            dtype = type_cache.get(type_name)
            if not dtype:
                dtype = DeviceType(name=type_name, icon_filename="")
                db.session.add(dtype)
                db.session.flush()
                type_cache[type_name] = dtype
            type_id = dtype.id
        else:
            type_id = dev_data.get("type_id")
```

---

## ПРИОРИТЕТ 3 — гигиена и мелочи

### 3.1. Мёртвый `DocumentFragment`

Файл: `static/js/src/map/elements.js`, строка ~91. `frag` создаётся, но никогда не
используется (узлы кладутся в `allElements`).

**Было:**
```javascript
            if (data.nodes && data.nodes.length) {
                const frag = document.createDocumentFragment();
                data.nodes.forEach(n => {
```

**Стало:**
```javascript
            if (data.nodes && data.nodes.length) {
                data.nodes.forEach(n => {
```

---

### 3.2. Динамические `import()` на каждую загрузку элементов → статические

Файл: `static/js/src/map/elements.js`, строки ~140–141.

**Было:**
```javascript
            // Обновление меток и групп
            import('./edgeLabels.js').then(m => m.updateAllEdgeLabels());
            import('./groupResize.js').then(m => m.updateAllGroups());
```

**Стало** — добавить статические импорты вверху файла:
```javascript
import { updateAllEdgeLabels } from './edgeLabels.js';
import { updateAllGroups } from './groupResize.js';
```
и в теле:
```javascript
            // Обновление меток и групп
            updateAllEdgeLabels();
            updateAllGroups();
```

> Проверьте, что нет циклических импортов (`edgeLabels.js` / `groupResize.js` не должны
> импортировать `elements.js`). esbuild соберёт, но цикл лучше исключить.

---

### 3.3. Очистка слушателей и таймеров при перезагрузке карты

- `static/js/src/map/lock.js` — `window.socket.on('map_lock_updated', …)` вешается без
  парного `.off()`. При смене карты слушатели накапливаются. Добавить cleanup и снимать
  слушатель перед повторной подпиской.
- `static/js/src/map/edgeLabels.js`, `groupResize.js` — модульные `updateTimeout`
  не сбрасываются при `reloadMapElements`. Добавить экспортируемую `cleanup()` и вызывать
  её из `initCy()` перед `cy.destroy()`.

Это не баг «здесь и сейчас», но при долгой работе и переключении карт даёт дубли
обработчиков и «отложенные» срабатывания на новой карте.

---

### 3.4. Недостающие индексы (дёшево)

Файл: `models.py`.

**Было:**
```python
    type_id = db.Column(db.Integer, db.ForeignKey("device_type.id"))
    ...
    map_id = db.Column(db.Integer, db.ForeignKey("map.id"))   # в классе Group
```

**Стало:**
```python
    type_id = db.Column(db.Integer, db.ForeignKey("device_type.id"), index=True)
    ...
    map_id = db.Column(db.Integer, db.ForeignKey("map.id"), index=True)  # Group
```

> Потребуется миграция (`migrate_db.py` / Alembic). Эффект небольшой (типов и групп
> немного), поэтому — низкий приоритет.

---

## АРХИТЕКТУРНОЕ (на перспективу, отдельными задачами)

### A. Точечные сокет-события вместо полного `map_updated`

Сейчас почти каждое изменение (устройство, связь, группа, фигура) шлёт `map_updated`,
а клиенты в ответ делают **полную перезагрузку карты** (`reloadMapElements(force=true)`).
Несколько правок подряд = несколько полных reload у других вкладок.

Направление: слать конкретные события (`device_updated`, `link_updated`,
`position_updated`, `device_removed`) с полезной нагрузкой и применять их инкрементально
на клиенте (`updateDevice`, `addDeviceToGraph`, `removeDeviceFromGraph` уже есть в
`index.js`), без полного перезапроса карты. `map_updated` оставить только для крупных
изменений (импорт, массовое редактирование).

### B. SQLite → PostgreSQL при многопользовательском сценарии

Мониторинг постоянно пишет статусы, веб пишет позиции. На SQLite запись сериализуется
(блокировки на запись), при нескольких активных пользователях + мониторинге это даёт
задержки. Для продакшена с несколькими пользователями — PostgreSQL.

---

## Чек-лист внедрения

- [x] 1.1 `monitor.py`: joinedload(ips) + один контекст + словарь + `device_status_batch`
- [x] 1.2 `undoRedo.js`: bulk `/api/devices/positions`
- [x] 2.1 убрать дубль `cy.on('pan zoom')` в `core.js`
- [x] 2.2 `applyGrayStyle` — один `.style({...})`
- [x] 2.3 применение стилей при загрузке в `cy.batch()`
- [x] 2.4 `pulse.js` — цикл в `cy.batch()`
- [x] 2.5 вернуть подавление hover-подсветки во время рамки
- [x] 2.6 `export_map_data` — joinedload
- [x] 2.7 `get_map_groups` — `func.count`
- [x] 2.8 `import_map` — кэш типов
- [x] 3.1 удалить мёртвый `frag`
- [x] 3.2 статические импорты вместо `import()`
- [x] 3.3 cleanup слушателей/таймеров при reload
- [x] 3.4 индексы `type_id`, `Group.map_id` (+ миграция)
- [x] A. точечные сокет-события (отдельная задача)
- [ ] B. миграция на PostgreSQL (отдельная задача)
- [ ] После JS-правок: `npm run build:map` и проверить карту в браузере
