import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cytoscape = require('../../static/js/cytoscape.min.js');

class Element extends EventTarget {
    children = [];
    attrs = {};
    dataset = {};
    style = {};
    hidden = false;
    value = '';
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attrs[key] = value; }
    removeAttribute(key) { delete this.attrs[key]; }
    remove() {}
    scrollIntoView() {}
    getBoundingClientRect() { return { left: 80, bottom: 120, width: 210, height: 36 }; }
}

const input = new Element();
globalThis.document = Object.assign(new EventTarget(), {
    getElementById: id => id === 'searchInput' ? input : null,
    createElement: () => new Element(),
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { clientWidth: 1000 },
    body: new Element(),
});
globalThis.window = new EventTarget();
window.currentMapId = 100;
window.t = key => key;
globalThis.CustomEvent ??= class extends Event {
    constructor(type, options) { super(type); this.detail = options.detail; }
};
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };

const { initSearch, cleanup } = await import('../../static/js/src/map/search.js');
const { initVisibility, setLayerVisibility, setStatusFilter, cleanupVisibility } = await import('../../static/js/src/map/visibility.js');
const { collapseGroup, saveCollapseState } = await import('../../static/js/src/map/groupCollapse.js');
const cy = cytoscape({ headless: true, styleEnabled: true, elements: [
    { data: { id: 'outer', isGroup: true } },
    { data: { id: 'inner', parent: 'outer', isGroup: true } },
    { data: { id: '1', parent: 'inner', name: 'Router-1', ip: '198.51.100.1', status: 'down' } },
    { data: { id: '2', parent: 'inner', name: 'Router-2', type: 'router', status: 'up' } },
    { data: { id: '3', name: 'Switch', status: 'up' } },
    { data: { id: 'shape', name: 'Router zone', isShape: true } },
    { data: { id: 'link_5', source: '1', target: '3', label: 'port' } },
] });
cy.width = () => 800;
cy.height = () => 600;
initVisibility(cy);
const [outer, inner, target, neighbor, link] = ['outer', 'inner', '1', '2', 'link_5'].map(id => cy.$id(id));
collapseGroup(inner);
collapseGroup(outer);
const storageBefore = storage.get('groupCollapseState:100');
setLayerVisibility({ deviceLayers: new Map([[1, [7]], [2, [7]]]), visibleLayerIds: [] });
setStatusFilter('up');
assert.equal(target.visible(), false);
initSearch(cy);
const [popup] = document.body.children;
const [list] = popup.children;
function key(destination, name) {
    destination.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: name }));
}

input.value = 'router';
input.dispatchEvent(new Event('input'));
await new Promise(resolve => setTimeout(resolve, 250));
assert.equal(popup.hidden, false);
assert.equal(list.children.length, 2, 'hidden devices are results, map zones are not');
key(input, 'ArrowDown');
assert.equal(input.attrs['aria-activedescendant'], 'mapSearchResult-0');
key(input, 'ArrowDown');
assert.equal(input.attrs['aria-activedescendant'], 'mapSearchResult-1');
key(input, 'ArrowUp');

cy.panningEnabled(false);
key(input, 'Enter');
assert.equal(popup.hidden, true);
assert.equal(cy.panningEnabled(), false);
assert.equal(target.visible(), true);
assert.equal(neighbor.visible(), false, 'layer override applies only to the result');
assert.equal(link.visible(), false, 'ports do not expose hidden links');
assert.equal(outer.data('collapsed'), undefined);
assert.equal(inner.data('collapsed'), undefined);
assert.equal(Math.round(target.renderedPosition('x')), 400);
assert.equal(Math.round(target.renderedPosition('y')), 300);
saveCollapseState(cy);
assert.deepEqual(JSON.parse(storage.get('groupCollapseState:100')).sort(), JSON.parse(storageBefore).sort());

key(document, 'Escape');
assert.equal(target.visible(), false);
assert.equal(outer.data('collapsed'), true);
assert.equal(inner.data('collapsed'), true);
assert.equal(neighbor.visible(), false);

input.value = '198.51.100.1';
input.dispatchEvent(new Event('input'));
await new Promise(resolve => setTimeout(resolve, 250));
assert.equal(list.children.length, 1);
const row = list.children[0];
// Simulate bubbling from a real option for the minimal DOM fixture.
const click = new Event('click');
Object.defineProperty(click, 'target', { value: { closest: () => row } });
popup.dispatchEvent(click);
assert.equal(target.visible(), true);
input.value = 'switch';
input.dispatchEvent(new Event('input'));
assert.equal(target.visible(), false, 'changing the query ends the temporary reveal');
cleanup();
cleanupVisibility();
cy.destroy();
console.log('Map search: hidden results, keyboard and click navigation, group and layer restoration passed');
