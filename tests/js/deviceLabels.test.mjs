/**
 * Тесты HTML-подписей устройств — static/js/src/map/deviceLabels.js
 *
 * Запуск: npm run test:js
 */
import assert from 'node:assert/strict';

// ── Минимальный DOM ──────────────────────────────────────────────────────────
class El {
    constructor(tag) {
        this.tag = tag; this.children = []; this.parent = null; this.dataset = {};
        this.style = { setProperty(k, v) { this[k] = v; } };
        this.hidden = false; this.className = ''; this._text = '';
        const set = new Set();
        this.classList = {
            add: c => set.add(c), remove: c => set.delete(c),
            toggle: (c, on) => { (on === undefined ? !set.has(c) : on) ? set.add(c) : set.delete(c); },
            contains: c => set.has(c),
        };
    }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
    setAttribute() {}
    set textContent(v) { this._text = String(v); }
    get textContent() { return this._text; }
}
const winListeners = new Map();
globalThis.window = {
    addEventListener: (n, f) => winListeners.set(n, f),
    removeEventListener: n => winListeners.delete(n),
};
globalThis.document = { createElement: tag => new El(tag) };
let frames = [];
globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
const runFrames = () => { const f = frames; frames = []; f.forEach(fn => fn()); };

// ── Фейковый cy ─────────────────────────────────────────────────────────────
function makeNode(id, data, pos = { x: 0, y: 0 }) {
    const classes = new Set();
    const node = {
        _data: { id, ...data }, _pos: pos, _removed: false, _visible: true, length: 1,
        id: () => id, data: k => node._data[k], position: () => node._pos,
        outerHeight: () => 60, visible: () => node._visible, removed: () => node._removed,
        selected: () => false, isNode: () => true,
        hasClass: c => classes.has(c), addClass: c => classes.add(c), removeClass: c => classes.delete(c),
    };
    return node;
}
function makeCy(container) {
    const nodes = new Map(); const handlers = [];
    const cy = {
        _destroyed: false, _zoom: 1, _pan: { x: 0, y: 0 },
        container: () => container, destroyed: () => cy._destroyed,
        zoom: () => cy._zoom, pan: () => cy._pan,
        on: (ev, sel, fn) => handlers.push({ ev, fn: fn || sel }),
        off: (ev, sel, fn) => { const f = fn || sel; const i = handlers.findIndex(h => h.fn === f); if (i >= 0) handlers.splice(i, 1); },
        emit: (ev, node) => handlers.filter(h => h.ev.split(' ').includes(ev)).forEach(h => h.fn({ target: node })),
        handlerCount: () => handlers.length,
        getElementById: id => nodes.get(id) || { length: 0 },
        nodes: sel => {
            const all = [...nodes.values()];
            const list = typeof sel === 'string' && sel.startsWith('.') ? all.filter(n => n.hasClass(sel.slice(1))) : all.filter(n => !n.data('isGroup') && !n.data('isShape'));
            return { forEach: fn => list.forEach(fn), removeClass: c => list.forEach(n => n.removeClass(c)) };
        },
        add: n => { nodes.set(n.id(), n); cy.emit('add', n); },
        drop: n => { n._removed = true; nodes.delete(n.id()); cy.emit('remove', n); },
    };
    return cy;
}

const { initDeviceLabels } = await import('../../static/js/src/map/deviceLabels.js');
const { isCyAlive, initZoomLabelStyles } = await import('../../static/js/src/map/labelScale.js');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };
const cards = container => container.children[0].children[0].children;

test('карточка: название и IP отдельными элементами, позиция в координатах графа', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    cy.add(makeNode('1', { name: 'sw-1', ip: '10.0.0.1', iconUrl: '/i.png', fontSize: 12 }, { x: 100, y: 50 }));
    runFrames();
    const [card] = cards(container);
    assert.equal(card.children[0].textContent, 'sw-1');
    assert.equal(card.children[1].textContent, '10.0.0.1');
    // zoom = 1: позиция = координата узла × zoom (+ половина высоты иконки + зазор)
    assert.equal(card.style.transform, 'translate(100px, 84px) scale(1)'); // 50 + 30 + 4
    assert.equal(card.style['--lv-fs'], '13.2px');                       // 12 × 1.1
    dispose();
});

test('без IP строки IP нет, пустая строка не создаётся', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    cy.add(makeNode('1', { name: 'sw-1', ip: '', iconUrl: '/i.png' }));
    runFrames();
    assert.equal(cards(container)[0].children.length, 1);
    dispose();
});

test('несколько IP выводятся одной строкой через запятую', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    cy.add(makeNode('1', { name: 'sw', ip: '10.0.0.1, 10.0.0.2', iconUrl: '/i.png' }));
    runFrames();
    assert.equal(cards(container)[0].children[1].textContent, '10.0.0.1, 10.0.0.2');
    dispose();
});

test('группы и фигуры не получают карточек', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    cy.add(makeNode('g', { name: 'G', isGroup: true }));
    cy.add(makeNode('s', { label: 'S', isShape: true }));
    runFrames();
    assert.equal(cards(container).length, 0);
    dispose();
});

test('изменение данных, скрытие и удаление узла синхронизируются без дублей', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    const node = makeNode('1', { name: 'a', ip: '1.1.1.1', iconUrl: '/i.png' });
    cy.add(node); runFrames();
    node._data.name = 'b'; cy.emit('data', node); runFrames();
    assert.equal(cards(container).length, 1);
    assert.equal(cards(container)[0].children[0].textContent, 'b');
    node._visible = false; cy.emit('style', node); runFrames();
    assert.equal(cards(container)[0].hidden, true);
    cy.drop(node); runFrames();
    assert.equal(cards(container).length, 0);
    dispose();
});

test('перезагрузка элементов (elements:loaded) убирает осиротевшие карточки', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    const node = makeNode('1', { name: 'a', iconUrl: '/i.png' });
    cy.add(node); runFrames();
    cy.getElementById = () => ({ length: 0 });
    cy.nodes = () => ({ forEach: () => {}, removeClass: () => {} });
    winListeners.get('elements:loaded')(); runFrames();
    assert.equal(cards(container).length, 0);
    dispose();
});

test('dispose снимает слой, обработчики и возвращает нативные подписи', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    const node = makeNode('1', { name: 'a', iconUrl: '/i.png' });
    cy.add(node); runFrames();
    assert.equal(node.hasClass('lv-html-label'), true);
    dispose();
    assert.equal(container.children.length, 0);
    assert.equal(cy.handlerCount(), 0);
    assert.equal(winListeners.has('elements:loaded'), false);
    assert.equal(node.hasClass('lv-html-label'), false);
});

test('повторная инициализация не оставляет второй слой', () => {
    const container = new El('div'); const cy = makeCy(container);
    initDeviceLabels(cy);
    const dispose = initDeviceLabels(cy);
    assert.equal(container.children.length, 1);
    dispose();
});

test('карточка и зазор масштабируются вместе с устройством, слой масштабирования не получает', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    cy.add(makeNode('1', { name: 'a', iconUrl: '/i.png' }, { x: 100, y: 0 })); runFrames();
    cy._pan = { x: 10, y: 20 }; cy.emit('viewport'); runFrames();
    const layer = container.children[0].children[0];
    assert.equal(layer.style.transform, 'translate(10px, 20px)');
    cy._zoom = 0.3; cy.emit('viewport'); runFrames();
    assert.equal(layer.style.transform, 'translate(10px, 20px)'); // без scale()
    // x = 100 × 0.3; (30 + 4) × 0.3 = 10.2; размер карточки = zoom
    assert.equal(cards(container)[0].style.transform, 'translate(30px, 10.2px) scale(0.3)');
    dispose();
});

test('при приближении карточка увеличивается пропорционально устройству', () => {
    const container = new El('div'); const cy = makeCy(container);
    const dispose = initDeviceLabels(cy);
    cy.add(makeNode('1', { name: 'a', iconUrl: '/i.png' })); runFrames();
    cy._zoom = 4; cy.emit('viewport'); runFrames();
    assert.equal(cards(container)[0].style.transform, 'translate(0px, 136px) scale(4)');
    dispose();
});

test('isCyAlive: живой, уничтоженный, без метода destroyed, отвязанный контейнер, null', () => {
    const container = new El('div');
    const cy = makeCy(container);
    assert.equal(isCyAlive(cy), true);
    container.isConnected = false;
    assert.equal(isCyAlive(cy), false);
    container.isConnected = true;
    cy._destroyed = true;
    assert.equal(isCyAlive(cy), false);
    assert.equal(isCyAlive({ _private: { destroyed: true } }), false);
    assert.equal(isCyAlive({ _private: { destroyed: false } }), true);
    assert.equal(isCyAlive({ destroyed() { throw new Error('boom'); } }), false);
    assert.equal(isCyAlive(null), false);
});

test('destroy графа: слой и обработчики снимаются, узлы умирающего графа не трогаются', () => {
    const container = new El('div'); const cy = makeCy(container);
    initDeviceLabels(cy);
    const node = makeNode('1', { name: 'a', iconUrl: '/i.png' });
    cy.add(node); runFrames();
    let touched = false;
    node.removeClass = () => { touched = true; };
    cy.emit('destroy');
    assert.equal(container.children.length, 0);
    assert.equal(cy.handlerCount(), 0);
    assert.equal(touched, false);
    runFrames(); // отложенный rAF после destroy не падает
});

test('отложенный rAF после уничтожения/отвязки графа сворачивает слой без ошибок', () => {
    const container = new El('div'); const cy = makeCy(container);
    initDeviceLabels(cy);
    cy.add(makeNode('1', { name: 'a', iconUrl: '/i.png' }));
    cy._destroyed = true;           // граф уничтожен без события destroy
    runFrames();
    assert.equal(container.children.length, 0);
    assert.equal(cy.handlerCount(), 0);

    const container2 = new El('div'); const cy2 = makeCy(container2);
    initDeviceLabels(cy2);
    cy2.add(makeNode('2', { name: 'b', iconUrl: '/i.png' }));
    container2.isConnected = false; // контейнер убрали из DOM
    runFrames();
    assert.equal(container2.children.length, 0);
});

test('повторная инициализация на новом cy: старый слой и обработчики удалены, дублей нет', () => {
    const c1 = new El('div'); const cy1 = makeCy(c1);
    initDeviceLabels(cy1);
    cy1.add(makeNode('1', { name: 'a', iconUrl: '/i.png' })); runFrames();
    const c2 = new El('div'); const cy2 = makeCy(c2);
    initDeviceLabels(cy2);                // старый слой снимается сам
    assert.equal(c1.children.length, 0);
    assert.equal(cy1.handlerCount(), 0);
    cy2.add(makeNode('1', { name: 'a', iconUrl: '/i.png' })); runFrames();
    assert.equal(c2.children.length, 1);
    assert.equal(cards(c2).length, 1);
});

test('initZoomLabelStyles: destroy и повторная инициализация снимают обработчики', () => {
    const calls = [];
    const mk = () => {
        const cy = makeCy(new El('div'));
        cy.edges = () => ({ updateStyle: () => calls.push('edges') });
        cy.batch = fn => fn();
        cy.nodes = () => ({ updateStyle: () => calls.push('groups'), forEach() {}, removeClass() {} });
        return cy;
    };
    const cy1 = mk(); initZoomLabelStyles(cy1);
    assert.equal(cy1.handlerCount(), 2);
    const cy2 = mk(); initZoomLabelStyles(cy2);
    assert.equal(cy1.handlerCount(), 0);
    assert.equal(cy2.handlerCount(), 2);
    cy2._zoom = 0.5; cy2.emit('zoom'); runFrames();
    assert.deepEqual(calls, ['edges', 'groups']);
    cy2.emit('destroy');
    assert.equal(cy2.handlerCount(), 0);
    cy2._zoom = 0.2; cy2.emit('zoom'); runFrames();   // уже ничего не делает
    assert.equal(calls.length, 2);
});

console.log(`${passed} deviceLabels tests passed`);
