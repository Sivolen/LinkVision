import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cytoscape = require('../../static/js/cytoscape.min.js');
const frames = new Map();
let nextFrame = 0;
globalThis.requestAnimationFrame = callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
};
globalThis.cancelAnimationFrame = id => frames.delete(id);
function flush() {
    for (const [id, callback] of [...frames]) {
        if (frames.delete(id)) callback();
    }
}
function createElement() {
    return {
        children: [],
        classes: new Set(),
        style: { values: new Map(), setProperty(key, value) { this.values.set(key, value); } },
        append(...children) { this.children.push(...children); },
        remove() { this.removed = true; },
        get classList() {
            return { toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name) };
        },
    };
}
globalThis.window = new EventTarget();
window.t = key => ({ 'focusLabel.source': 'From:', 'focusLabel.target': 'To:', 'focusLabel.noInterface': 'interface not specified' })[key];
globalThis.document = Object.assign(new EventTarget(), { createElement });
const { initFocusLabel } = await import('../../static/js/src/map/focusLabel.js');

const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    layout: { name: 'preset' },
    elements: [
        { data: { id: 'left', name: 'Switch <A>', ip: '192.0.2.10' }, position: { x: 200, y: 120 } },
        { data: { id: 'right', name: 'Router B' }, position: { x: 110, y: 200 } },
        { data: { id: 'edge', source: 'left', target: 'right', srcIface: 'Gi0/1', tgtIface: null } },
        { data: { id: 'proxy', source: 'left', target: 'right', isCollapseProxy: true } },
    ],
});
const container = createElement();
container.appendChild = child => container.append(child);
const inspector = { offsetWidth: 0 };
container.parentElement = { querySelector: () => inspector };
let onInspectorResize;
let inspectorObserverDisconnected = false;
globalThis.ResizeObserver = class {
    constructor(callback) { onInspectorResize = callback; }
    observe(element) { assert.equal(element, inspector); }
    disconnect() { inspectorObserverDisconnected = true; }
};
const originalContainer = cy.container;
cy.container = () => container;
cy.width = () => 500;
cy.height = () => 400;
const [first, second, edge, proxy] = ['left', 'right', 'edge', 'proxy'].map(id => cy.$id(id));
edge.renderedMidpoint = () => ({ x: 250, y: 160 });

const cleanup = initFocusLabel(cy);
const [card] = container.children;
const [title, detail] = card.children;
assert.equal(card.hidden, true);
cy.emit('viewport');
assert.equal(frames.size, 0, 'navigation with no focus schedules no render');

first.emit('tap');
flush();
assert.equal(card.hidden, false);
assert.equal(title.textContent, 'Switch <A>');
assert.equal(detail.textContent, '192.0.2.10');
inspector.offsetWidth = 240;
onInspectorResize();
flush();
assert.equal(card.style.values.get('--focus-area-width'), '260px');
inspector.offsetWidth = 390;
onInspectorResize();
flush();
assert.equal(card.hidden, true, 'the inspector already shows the details on a narrow viewport');
inspector.offsetWidth = 0;
onInspectorResize();
flush();
assert.equal(card.hidden, false);
second.emit('tap');
flush();
assert.equal(detail.hidden, true, 'no blank IP row');

edge.emit('tap');
cy.emit('viewport');
cy.emit('viewport');
assert.equal(frames.size, 1);
flush();
assert.equal(title.textContent, 'From: Switch <A> · Gi0/1');
assert.equal(detail.textContent, 'To: Router B · interface not specified');
edge.data('tgtIface', 'WAN');
second.data('name', 'Router C');
flush();
assert.equal(detail.textContent, 'To: Router C · WAN');
cy.viewport({ zoom: 1, pan: { x: 0, y: 0 } });
edge.renderedMidpoint = () => ({ x: -250, y: 160 });
edge.emit({ type: 'tap', position: { x: 50, y: 160 } });
flush();
assert.equal(card.hidden, false, 'a visible segment is enough to inspect a long link');
assert.equal(card.style.values.get('--focus-x'), '50px');
edge.renderedMidpoint = () => ({ x: 250, y: 160 });
second.hide();
window.dispatchEvent(new Event('linkvision:map-filter-changed'));
flush();
assert.equal(card.hidden, true);
second.show();

proxy.emit('tap');
flush();
assert.equal(card.hidden, true, 'proxy edge has no unique port pair');
edge.emit('tap');
flush();
assert.equal(card.hidden, false);
document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
assert.equal(card.hidden, true);
first.emit('tap');
first.remove();
flush();
assert.equal(card.hidden, true);
cleanup();
assert.equal(card.removed, true);
assert.equal(inspectorObserverDisconnected, true);
cy.emit('viewport');
assert.equal(frames.size, 0);
cy.container = originalContainer;
cy.destroy();
console.log('Focus label: device and edge content, visibility, viewport and lifecycle passed');
