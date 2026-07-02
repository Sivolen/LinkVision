Нашёл причину. Она однозначная.



## Корень проблемы



Сервер шлёт точечные события через обёртку `_notify` ([notifications.py:16](services/notifications.py#L16)):



```python

def _notify(map_id, event, payload, skip_sid=None):

    socketio.emit(event, payload, room=f"map_{map_id}", skip_sid=skip_sid)

```



Обрати внимание: `map_id` используется только для имени комнаты, но **в сам payload не кладётся**. То есть payload для `device_position_updated` — это `{"device_id", "x", "y"}`, для `device_updated` — `{"device": ...}` и т.д. Поля `map_id` там **нет**.



А каждый клиентский обработчик ([index.js:161–265](static/js/src/map/index.js#L161)) начинается с проверки:



```js

window.socket.on('device_position_updated', (data) => {

    if (Number(data.map_id) !== Number(mapId)) return;   // ← data.map_id === undefined

    ...

});

```



`data.map_id` — `undefined` → `Number(undefined)` — это `NaN` → `NaN !== mapId` всегда `true` → **обработчик выходит на первой строке и ничего не применяет**. И так для ВСЕХ 14 точечных событий (device/link/group/shape — create/update/delete/position).



**Почему раньше работало:** старый путь `map_updated` слал payload `{"map_id": map_id}` — с полем `map_id`, поэтому проверка проходила. При переходе на точечные события поле потеряли, а клиентскую проверку оставили. `device_status`/`device_status_batch` работают по той же причине — у них `map_id` в payload есть (или проверки нет).



## Фикс — одна строка



Комната `map_{map_id}` уже гарантирует, что событие адресовано нужной карте, но раз клиент проверяет `data.map_id`, проще всего добавить поле в payload в единой точке — обёртке `_notify`. Это чинит все 14 событий разом.



**Файл `services/notifications.py`, строки 16–20.**



**Было:**

```python

def _notify(map_id, event, payload, skip_sid=None):

    """Отправить точечное событие в комнату карты."""

    socketio.emit(

        event, payload, room=f"map_{map_id}", skip_sid=skip_sid

    )

```



**Стало:**

```python

def _notify(map_id, event, payload, skip_sid=None):

    """Отправить точечное событие в комнату карты."""

    # map_id обязателен в payload: клиентские обработчики отфильтровывают

    # события по data.map_id (см. static/js/src/map/index.js)

    socketio.emit(

        event, {**payload, "map_id": map_id}, room=f"map_{map_id}", skip_sid=skip_sid

    )

```