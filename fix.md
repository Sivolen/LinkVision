Я разобрал весь модуль карты (Cytoscape.js). Корень проблемы найден — и это не «много узлов вообще», а конкретно способ, которым рисуется выделение. Ниже разбор и решение.
 
## Где именно тормозит
 
Вся отрисовка выделения идёт через `updateSelection()` в [interactions.js:26](static/js/src/map/interactions.js#L26):
 
```js
newSelectedNodes.forEach(node => {
    node.style('border-color', '#007bff');
    node.style('border-width', '5px');          // ← вот это ключевая строка
    node.style('background-color', 'rgba(0,123,255,0.1)');
});
```
 
Здесь сходятся сразу три проблемы Cytoscape, и каждая множится на число выделенных узлов.
 
### 1. `.style(prop, value)` на каждый узел — это bypass-стили, а не класс
Каждый вызов `node.style('prop', val)` ставит индивидуальный «обходной» стиль и помечает элемент грязным. Это на порядок дороже, чем переключение класса, потому что Cytoscape не может сгруппировать такие изменения — он обрабатывает их поэлементно.
 
### 2. `border-width` меняет bounding box — и запускает каскад пересчётов
Это главное. `border-width` входит в габариты узла. Меняя 3px→5px у 50 узлов, Cytoscape вынужден для **каждого** узла:
- пересчитать его bounding box,
- инвалидировать пространственный индекс (r-tree),
- пересчитать геометрию **всех связанных рёбер** (точки кривой `bezier`, стрелки) и их подписи (`edgeLabels`),
- а главное — пересчитать **родительские группы** (`node[isGroup]`), у которых в [styles.js:184](static/js/src/map/styles.js#L184) стоит `compound-sizing-wrt-labels: include`, `min-width`, `bounds-expansion`. Любое изменение габаритов ребёнка заставляет группу пересчитать свой размер заново по всем детям.
 
Вот откуда нелинейность: при выделении внутри групп пересчёт становится близким к **O(n²)**. 5 узлов — мгновенно, 50+ — 15 секунд и заморозка главного потока.
 
### 3. Лишние полные обходы
В `boxstart` ([interactions.js:159](static/js/src/map/interactions.js#L159)) `resetAllInlineStyles(cy)` проходит **все** узлы и рёбра вне `batch`, дёргая `.style()` по 4–6 раз на элемент. Плюс в `boxend` строка `cy.nodes().intersection(rect)` ([:184](static/js/src/map/interactions.js#L184)) — некорректный вызов API (`intersection` ждёт коллекцию, а не прямоугольник `{x,y,w,h}`), поэтому всегда срабатывает медленный fallback с `renderedBoundingBox()` по всем узлам.
 
> Кстати, в [core.js:34](static/js/src/map/core.js#L34) вы уже закомментировали обработчик `cy.on('select
unselect', …)`, который делал `cy.nodes().forEach` на каждое событие select — это был ещё более грубый O(n²). Его убрали, но остаточная стоимость осталась в `updateSelection`.
 
## Решение
 
Принцип: **не трогать геометрию и не ставить bypass-стили поэлементно**. Два варианта — от минимального к правильному.
 
### Вариант A (минимальная правка, основной выигрыш)
 
Не менять `border-width` (он влияет на габариты) — использовать `overlay-*`/`underlay-*`, которые рисуются поверх и **не трогают bounding box**, и применять выделение **классом**, а не bypass-стилями.
 
В `styles.js` добавьте правило:
 
```js
{
    selector: 'node.selected-node',
    style: {
        'overlay-color': '#007bff',
        'overlay-opacity': 0.25,
        'overlay-padding': 4,
        'border-color': '#007bff'   // цвет можно — он габариты не меняет
        // border-width НЕ трогаем
    }
}
```
 
В `interactions.js` перепишите `updateSelection`:
 
```js
function updateSelection(newSelectedNodes) {
    const cy = getCy();
    if (!cy) return;
    const newIds = new Set(newSelectedNodes.map(n => n.id()));
 
    cy.batch(() => {
        for (const id of selectedNodesSet) {
            if (!newIds.has(id)) cy.getElementById(id).removeClass('selected-node');
        }
        newSelectedNodes.forEach(node => {
            if (!selectedNodesSet.has(node.id())) node.addClass('selected-node');
        });
        selectedNodesSet = newIds;
    });
    updateBulkEditButton();
}
```
 
Классы Cytoscape диффит и применяет пакетно, а отказ от `border-width` убирает весь каскад пересчёта рёбер/групп. Это снимает 90% тормозов.
 
### Вариант B (правильный — отдать выделение нативному движку)
 
У вас в `setMode('select')` уже включены `boxSelectionEnabled(true)` и `autounselectify(false)` ([modes.js:18](static/js/src/map/modes.js#L18)) — то есть Cytoscape **сам нативно выделяет** узлы рамкой, просто для `:selected` нет стиля. Тогда ручной `updateSelection`/`boxend`-фильтр вообще не нужен:
 
```js
// styles.js
{ selector: 'node:selected',
  style: { 'overlay-color':'#007bff', 'overlay-opacity':0.25, 'overlay-padding':4 } }
```
 
И везде, где читается набор выделенных (`bulk.js`, групповой drag), заменить `selectedNodesSet.has(id)` на `node.selected()` / `cy.$('node:selected')`. Тогда отрисовка выделения 50 узлов идёт одним нативным проходом, а ваши `boxstart`/`boxend`-обработчики со ручным пересчётом рамки и `renderedBoundingBox()` удаляются целиком.
 
### Дополнительно
- Оберните `resetAllInlineStyles` в `cy.batch()` (или вызывайте `cy.elements().removeStyle()` один раз вместо поэлементного сброса).
- Уберите вложенный `cy.batch()` в `boxend` (внутри уже batch в `updateSelection`).
 
## Как проверить, что это именно оно
 
Откройте DevTools → Performance, запишите выделение 50 узлов. В пламени увидите время, ушедшее не в ваш JS, а в `recalculateRenderedStyle` / `recalculateBoundingBox` / обновление r-tree внутри cytoscape — это подтверждает каскад от `border-width`. После правки этот участок исчезает.
 
 