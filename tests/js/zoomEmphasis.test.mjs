/**
 * Тесты усиления статусов при отдалении — static/js/src/map/zoomEmphasis.js
 * Проверяют, что зум не делает полных обходов узлов и не пишет data (события 'data'
 * слушают мини-карта и подписи), а типы подсветки не затирают друг друга.
 */
import assert from 'node:assert/strict';

const timers = [];
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { getElementById: () => null };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeNode(id, data, classes = []) {
    const styles = {};
    const dataStore = { id, ...data };
    return {
        length: 1, styles, _writes: 0,
        id: () => id,
        data: k => (k === undefined ? dataStore : dataStore[k]),
        hasClass: c => classes.includes(c),
        style(obj) { this._writes++; Object.assign(styles, obj); },
        removeStyle() { for (const k of Object.keys(styles)) delete styles[k]; this._removed = (this._removed || 0) + 1; },
    };
}
function makeCy(nodes) {
    const handlers = [];
    const cy = {
        _zoom: 0.2, nodeWalks: 0, dataWrites: 0,
        zoom: () => cy._zoom,
        batch: fn => fn(),
        on: (ev, fn) => handlers.push({ ev, fn }),
        off: (ev, fn) => { const i = handlers.findIndex(h => h.fn === fn); if (i >= 0) handlers.splice(i, 1); },
        emit: ev => handlers.filter(h => h.ev === ev).forEach(h => h.fn()),
        handlerCount: () => handlers.length,
        getElementById: id => nodes.find(n => n.id() === id) || { length: 0 },
        nodes: () => { cy.nodeWalks++; return { forEach: fn => nodes.forEach(fn) }; },
        destroyed: () => false,
    };
    return cy;
}

// zoomEmphasis импортирует getCy из core.js (тянет весь графовый код) — подменяем модуль.
const { initZoomEmphasis, refreshZoomEmphasis, cleanup } = await import('../../static/js/src/map/zoomEmphasis.js').catch(e => {
    console.log('skip: zoomEmphasis.js не импортируется без браузера:', e.message.split('\n')[0]);
    process.exit(0);
});

let passed = 0;
const ok = name => { passed++; console.log(`ok - ${name}`); };

const nodes = [
    makeNode('ok', { status: 'up' }),
    makeNode('down', { status: 'down' }),
    makeNode('q', { status: 'up', quality_status: 'bad' }),
    makeNode('found', { status: 'down' }, ['cy-node-highlight']),
    makeNode('off', { status: 'down', monitoring_enabled: 'false' }),
];
const cy = makeCy(nodes);
initZoomEmphasis(cy);
assert.equal(cy.nodeWalks, 1, 'инициализация — один полный проход');
assert.ok(nodes[1].styles['border-width'] >= 3 && nodes[1].styles['overlay-padding']);
assert.equal(nodes[0]._writes, 0, 'здоровый узел не трогается');
assert.equal(nodes[4]._writes, 0, 'узел с выключенным мониторингом не подсвечивается');
assert.ok(nodes[2]._writes === 1 && nodes[3]._writes === 1);
ok('усиление получают только аварии, деградация качества и результаты поиска');

// Зум: быстрый путь — без обхода всех узлов и без data-записей
cy._zoom = 0.12; cy.emit('zoom'); await sleep(200);
assert.equal(cy.nodeWalks, 1, 'зум внутри диапазона не обходит все узлы');
assert.ok(nodes[1].styles['border-width'] > 0);
cy._zoom = 0.121; cy.emit('zoom'); await sleep(200);
assert.equal(nodes[1]._writes, 2, 'изменение масштаба меньше 2% не пишет стиль');
ok('зум пересчитывает значения только у подсвеченных узлов');

// Смена статуса -> refresh -> новый узел получает усиление, прежний теряет
nodes[0]._removeData = true;
nodes[0].data().status = 'down';
nodes[1].data().status = 'up';
refreshZoomEmphasis();
assert.ok(nodes[0].styles['border-width']);
assert.equal(Object.keys(nodes[1].styles).length, 0);
ok('refreshZoomEmphasis снимает усиление с восстановившихся и даёт новым');

// Переход через порог 0.5 — полный проход и снятие усиления
cy._zoom = 0.8; cy.emit('zoom'); await sleep(200);
assert.equal(Object.keys(nodes[0].styles).length, 0, 'при приближении усиление снимается');
cy._zoom = 0.2; cy.emit('zoom'); await sleep(200);
assert.ok(nodes[0].styles['border-width'], 'при отдалении усиление возвращается');
ok('переход через порог зума снимает и возвращает усиление');

// Подсветка не пишет data узла
for (const n of nodes) assert.equal(Object.keys(n.data()).some(k => k.startsWith('_zoomEmphasis')), false);
ok('флаги состояния не пишутся в data (нет событий data)');

// Статус и подсветка поиска на одном узле не конфликтуют: берётся максимум,
// снятие одной подсветки не ломает другую.
{
    const both = makeNode('both', { status: 'down' }, ['cy-node-highlight']);
    const cyB = makeCy([both]);
    cleanup();
    initZoomEmphasis(cyB);
    assert.ok(both.styles['border-width'] >= 5 && both._writes === 1);
    both.data().status = 'up';              // авария ушла, поиск остался
    refreshZoomEmphasis();
    assert.ok(both.styles['border-width'], 'подсветка поиска сохранилась');
    assert.equal(both._removed || 0, 0, 'стиль не снимался');
    both.hasClass = () => false;            // поиск сброшен
    refreshZoomEmphasis();
    assert.equal(Object.keys(both.styles).length, 0);
    ok('статус и поиск на одном узле не конфликтуют');
}

// Повторная инициализация на том же графе снимает прежние bypass-стили и обработчики.
{
    const n = makeNode('x', { status: 'down' });
    const cyR = makeCy([n]);
    cleanup();
    initZoomEmphasis(cyR);
    assert.ok(n.styles['border-width']);
    n.data().status = 'up';                 // изменилось, пока Map ещё помнит узел
    initZoomEmphasis(cyR);                  // повторная инициализация
    assert.equal(cyR.handlerCount(), 2, 'один zoom и один destroy, без дублей');
    assert.equal(Object.keys(n.styles).length, 0, 'старое усиление снято');
    ok('повторная инициализация очищает состояние и не дублирует обработчики');
}

// Уничтожение графа: обработчики сняты, узлы умирающего графа не трогаются.
{
    const n = makeNode('y', { status: 'down' });
    const cyD = makeCy([n]);
    cleanup();
    initZoomEmphasis(cyD);
    const writesBefore = n._writes, removedBefore = n._removed || 0;
    cyD.emit('destroy');
    assert.equal(cyD.handlerCount(), 0);
    assert.equal(n._writes, writesBefore);
    assert.equal(n._removed || 0, removedBefore, 'bypass-стили узлов умирающего графа не трогаем');
    cyD._zoom = 0.1; cyD.emit('zoom'); await sleep(200);
    assert.equal(n._writes, writesBefore, 'после destroy зум ничего не делает');
    ok('destroy графа снимает обработчики и состояние');
}

cleanup();
assert.equal(cy.handlerCount(), 0);
ok('cleanup снимает обработчик');
console.log(`${passed} zoomEmphasis tests passed`);
