## Откуда оставшиеся ~2 секунды

 

Один последний обработчик в [core.js:40](static/js/src/map/core.js#L40) свёл на нет часть выигрыша:

 

```js

cy.on('select unselect', () => {

    import('./bulk.js').then(module => module.updateBulkEditButton());

});

```

 

Нативная рамка шлёт событие `select` **на каждый узел отдельно** → 50 узлов = 50 событий. На каждое:

- отдельный динамический `import('./bulk.js')` (50 Promise-микротасков);

- внутри `updateBulkEditButton()` — `cy.nodes(':selected')`, то есть **полный проход по всем узлам графа** с фильтром → 50 × O(всех узлов) = **O(n²)**;

- запись `group.style.display` → форсированный reflow на каждое событие.

 

В прошлой версии у этой функции был debounce на 150 мс — при рефакторинге его потеряли.

 

## Что я поправил

 

Импортировал `bulk.js` статически один раз и схлопнул пачку событий в **один** вызов через `requestAnimationFrame`:

 

```js

cy.on('select unselect', () => {

    if (bulkBtnUpdateScheduled) return;

    bulkBtnUpdateScheduled = true;

    requestAnimationFrame(() => {

        bulkBtnUpdateScheduled = false;

        updateBulkEditButton();

    });

});

```

 

50 событий → 1 обновление кнопки, без 50 импортов и 50 полных сканов. Это должно убрать остаток задержки.

 

## Патч

`~/projects/fix-debounce-bulk-button.patch` (`git am`-совместимый, поверх текущего `ver2` / `01a219f`). Меняет `core.js` + пересобранный `dist/map.min.js`. Применение — как в прошлый раз:

 

```bash

git checkout ver2 && git checkout -b fix/debounce-bulk-button

git am < fix-debounce-bulk-button.patch

git push <ваш-форк> fix/debounce-bulk-button

```

 

## Если и после этого останется лёгкая задержка

Это будет уже сам нативный re-render N узлов, и упирается он в «тяжёлые» стили — в `styles.js` много правил со **значениями-функциями** (`width: fn`, `label: fn`, `font-size: fn`), которые Cytoscape пересчитывает для каждого узла на каждом restyle. Их замена на статические значения / `data()`-мапперы — следующий шаг, но это уже отдельный рефакторинг, и сначала стоит проверить, хватает ли debounce.

 

Точные правки в одном файле — `static/js/src/map/core.js`.

 

## 1. Вверху файла, в блоке импортов

 

**Было:**

```js

import { CY_STYLE } from './styles.js';

import { updateBackgroundTransform, enforcePanBounds } from './background.js';

import { saveViewportToServer } from './viewport.js';

 

let cy = null;

```

 

**Стало** (добавить импорт `bulk.js` и переменную-флаг):

```js

import { CY_STYLE } from './styles.js';

import { updateBackgroundTransform, enforcePanBounds } from './background.js';

import { saveViewportToServer } from './viewport.js';

import { updateBulkEditButton } from './bulk.js';   // ← ДОБАВИТЬ

 

let cy = null;

let bulkBtnUpdateScheduled = false;                  // ← ДОБАВИТЬ

```

 

## 2. Обработчик `select unselect` (примерно строка 40)

 

**УБРАТЬ полностью:**

```js

cy.on('select unselect', () => {

    import('./bulk.js').then(module => module.updateBulkEditButton());

});

```

 

**ДОБАВИТЬ на его место:**

```js

// Нативное выделение рамкой шлёт событие select на КАЖДЫЙ узел.

// Схлопываем пачку в один вызов через rAF — иначе 50+ узлов дают

// 50 динамических import() + 50 полных проходов cy.nodes(':selected') = O(n^2).

cy.on('select unselect', () => {

    if (bulkBtnUpdateScheduled) return;

    bulkBtnUpdateScheduled = true;

    requestAnimationFrame(() => {

        bulkBtnUpdateScheduled = false;

        updateBulkEditButton();

    });

});

```

 

## 3. Пересобрать бандл

 

Шаблон грузит `dist/map.min.js`, поэтому правка `src/` сама не подхватится:

 

```bash

npm run build:map

```

 

---

 

**Кратко:** убираешь `import('./bulk.js')` внутри обработчика (он вызывался на каждое событие) → заменяешь на статический импорт сверху + один вызов `updateBulkEditButton()` через `requestAnimationFrame`. Всё, что меняется, — этот один файл плюс пересборка `dist`.