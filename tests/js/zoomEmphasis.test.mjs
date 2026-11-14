/**
 * Тесты усиления статусов при отдалении — static/js/src/map/zoomEmphasis.js
 * Проверяют, что зум не делает полных обходов узлов и не пишет data (события 'data'
 * слушают мини-карта и подписи), а типы подсветки не затирают друг друга.
 */
import assert from 'node:assert/strict';

const windowHandlers = new Map();
globalThis.window = {
    addEventListener(event, handler) {
        const handlers = windowHandlers.get(event) || [];
        handlers.push(handler);
        windowHandlers.set(event, handlers);
    },
    removeEventListener(event, handler) {
        const handlers = windowHandlers.get(event) || [];
        windowHandlers.set(event, handlers.filter(item => item !== handler));
    }
};
globalThis.document = { getElementById: () => null };
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const emitWindow = event => (windowHandlers.get(event) || []).slice().forEach(handler => handler());
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

const { initZoomEmphasis, refreshZoomEmphasis, refreshNodeZoomEmphasis, cleanup } =
    await import('../../static/js/src/map/zoomEmphasis.js');

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
await nextFrame();
assert.equal(cy.nodeWalks, 1, 'инициализация — один полный проход');
assert.ok(nodes[1].styles['border-width'] >= 3 && nodes[1].styles['overlay-padding']);
assert.ok(nodes[0].styles['border-width'] >= 3, 'здоровый UP получает различимую рамку');
assert.equal(nodes[4]._writes, 0, 'узел с выключенным мониторингом не подсвечивается');
assert.ok(nodes[2]._writes === 1 && nodes[3]._writes === 1);
ok('статусы, качество и результаты поиска получают нужное усиление');

// Зум: быстрый путь — без обхода всех узлов и без data-записей
cy._zoom = 0.12; cy.emit('zoom'); await sleep(300);
cy._zoom = 0.125; cy.emit('zoom'); await sleep(300);
assert.equal(nodes[1]._writes, 1, 'пауза внутри серии зума не пересчитывает рамки');
await sleep(240);
assert.equal(cy.nodeWalks, 1, 'зум внутри диапазона не обходит все узлы');
assert.ok(nodes[1].styles['border-width'] > 0);
cy._zoom = 0.126; cy.emit('zoom'); await sleep(540);
assert.equal(nodes[1]._writes, 2, 'изменение масштаба меньше 2% не пишет стиль');
ok('зум пересчитывает значения только у подсвеченных узлов');

cy._zoom = 0.31; cy.emit('zoom'); await sleep(540);
const healthyWrites = nodes[0]._writes;
const downWrites = nodes[1]._writes;
cy._zoom = 0.32; cy.emit('zoom'); await sleep(540);
assert.equal(nodes[0]._writes, healthyWrites, 'UP-рамка сохраняется в том же диапазоне');
assert.ok(nodes[1]._writes > downWrites, 'аварийная рамка обновляется точнее');

// Смена статуса -> refresh -> новый узел получает усиление, прежний теряет
nodes[0]._removeData = true;
nodes[0].data().status = 'down';
nodes[1].data().status = 'up';
refreshZoomEmphasis();
await nextFrame();
assert.ok(nodes[0].styles['border-width']);
assert.ok(nodes[1].styles['border-width'], 'восстановившийся узел сохраняет тонкую UP-рамку');
ok('refreshZoomEmphasis меняет усиление статуса и сохраняет рамку UP');

// Переход через порог 0.5 — полный проход и снятие усиления
cy._zoom = 0.8; cy.emit('zoom'); await sleep(540);
assert.equal(Object.keys(nodes[0].styles).length, 0, 'при приближении усиление снимается');
cy._zoom = 0.2; cy.emit('zoom'); await sleep(540);
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
    await nextFrame();
    assert.ok(both.styles['border-width'] >= 5 && both._writes === 1);
    both.data().status = 'up';              // авария ушла, поиск остался
    refreshZoomEmphasis();
    await nextFrame();
    assert.ok(both.styles['border-width'], 'подсветка поиска сохранилась');
    assert.equal(both._removed || 0, 0, 'стиль не снимался');
    both.hasClass = () => false;            // поиск сброшен
    refreshZoomEmphasis();
    await nextFrame();
assert.ok(both.styles['border-width'], 'после поиска остаётся рамка UP');
    ok('статус и поиск на одном узле не конфликтуют');
}

// Повторная инициализация на том же графе снимает прежние bypass-стили и обработчики.
{
    const n = makeNode('x', { status: 'down' });
    const cyR = makeCy([n]);
    cleanup();
    initZoomEmphasis(cyR);
    await nextFrame();
    assert.ok(n.styles['border-width']);
    n.data().status = 'up';                 // изменилось, пока Map ещё помнит узел
    initZoomEmphasis(cyR);                  // повторная инициализация
    await nextFrame();
    assert.equal(cyR.handlerCount(), 2, 'один zoom и один destroy, без дублей');
    assert.ok(n.styles['border-width'], 'после восстановления остаётся рамка UP');
    ok('повторная инициализация очищает состояние и не дублирует обработчики');
}

// Уничтожение графа: обработчики сняты, узлы умирающего графа не трогаются.
{
    const n = makeNode('y', { status: 'down' });
    const cyD = makeCy([n]);
    cleanup();
    initZoomEmphasis(cyD);
    await nextFrame();
    const writesBefore = n._writes, removedBefore = n._removed || 0;
    cyD.emit('destroy');
    assert.equal(cyD.handlerCount(), 0);
    assert.equal(n._writes, writesBefore);
    assert.equal(n._removed || 0, removedBefore, 'bypass-стили узлов умирающего графа не трогаем');
    cyD._zoom = 0.1; cyD.emit('zoom'); await sleep(200);
    assert.equal(n._writes, writesBefore, 'после destroy зум ничего не делает');
    ok('destroy графа снимает обработчики и состояние');
}

// Полная синхронизация заменяет объекты узлов с теми же ID.
{
    const first = makeNode('same-id', { status: 'down' });
    const replacementNodes = [first];
    const graph = makeCy(replacementNodes);
    cleanup();
    initZoomEmphasis(graph);
    await nextFrame();
    const replacement = makeNode('same-id', { status: 'down' });
    replacementNodes[0] = replacement;
    refreshZoomEmphasis();
    await nextFrame();
    assert.ok(replacement.styles['overlay-padding'], 'новый узел получает ауру без изменения zoom');
    assert.equal(replacement._writes, 1);
    refreshZoomEmphasis();
    await nextFrame();
    assert.equal(replacement._writes, 1, 'неизменный узел повторно не стилизуется');
    ok('замена узла с тем же ID восстанавливает ауру');
}

// После F5 граф сначала пуст, затем элементы и фоновая подложка приходят
// асинхронно. Final fit может быть ПОСЛЕ elements:loaded, поэтому аура должна
// примениться на сигнал готового viewport, не дожидаясь ручного zoom.
{
    const lateNodes = [];
    const lateCy = makeCy(lateNodes);
    lateCy._zoom = 1;
    cleanup();
    initZoomEmphasis(lateCy);
    const lateDown = makeNode('late-down', { status: 'down' });
    lateNodes.push(lateDown);
    emitWindow('elements:loaded');
    assert.equal(lateDown._writes || 0, 0, 'до final fit при zoom=1 аура не применяется');
    lateCy._zoom = 0.2;
    emitWindow('linkvision:viewport-ready');
    await nextFrame();
    assert.ok(lateDown.styles['border-width'], 'поздно загруженный DOWN получает рамку');
    assert.ok(lateDown.styles['overlay-padding'], 'поздно загруженный DOWN получает ауру');
    ok('final viewport применяет ауры после асинхронной загрузки карты');
}

{
    const down = makeNode('down', { status: 'down' });
    const up = makeNode('up', { status: 'up' });
    const graph = makeCy([down, up]);
    initZoomEmphasis(graph);
    await nextFrame();
    const walks = graph.nodeWalks;
    const upWrites = up._writes;
    down.data().acknowledged = true;
    refreshNodeZoomEmphasis([down]);
    assert.equal(down.styles['overlay-padding'], undefined);
    down.data().acknowledged = false;
    refreshNodeZoomEmphasis([down]);
    assert.ok(parseFloat(down.styles['overlay-padding']) > 0);
    assert.equal(graph.nodeWalks, walks);
    assert.equal(up._writes, upWrites);
    ok('подтверждение и снятие отметки обновляют только изменившийся узел');
}
cleanup();
assert.equal(cy.handlerCount(), 0);
ok('cleanup снимает обработчик');
{
    const frames = new Map();
    let frameId = 0;
    globalThis.requestAnimationFrame = callback => {
        frames.set(++frameId, callback);
        return frameId;
    };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const many = Array.from({ length: 120 }, (_, i) => makeNode(String(i), { status: 'up' }));
    const graph = makeCy(many);
    initZoomEmphasis(graph);
    const flush = () => {
        const [id, callback] = frames.entries().next().value;
        frames.delete(id);
        callback();
    };
    refreshZoomEmphasis();
    assert.equal(frames.size, 1, 'full refresh replaces pending work');
    assert.ok(many.every(node => !node.styles['border-width']), 'full refresh waits for a frame');
    flush();
    assert.ok(many.some(node => node.styles['border-width']));
    assert.ok(many.some(node => !node.styles['border-width']), 'full refresh spans frames');
    while (frames.size) flush();
    graph._zoom = 0.8;
    graph.emit('zoom');
    await sleep(540);
    flush();
    const cleared = many.filter(node => !node.styles['border-width']).length;
    assert.ok(cleared > 0 && cleared < many.length, 'mass update spans multiple frames');
    assert.equal(frames.size, 1);

    graph._zoom = 0.2;
    graph.emit('zoom');
    assert.equal(frames.size, 0, 'a fresh zoom cancels stale updates');
    await sleep(540);
    while (frames.size) flush();
    assert.ok(many.every(node => node.styles['border-width']), 'interrupted zoom restores all frames');
    cleanup();
    ok('массовый пересчёт распределён по кадрам и отменяется новым зумом');
}
console.log(`${passed} zoomEmphasis tests passed`);
