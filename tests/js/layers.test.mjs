import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cytoscape = require('../../static/js/cytoscape.min.js');
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
globalThis.document = { documentElement: { getAttribute: () => 'light' } };
const { initVisibility, setLayerVisibility, applyMapVisibility } = await import('../../static/js/src/map/visibility.js');
const cy = cytoscape({ headless: true, styleEnabled: true, elements: [
    { data: { id: 'g', isGroup: true } },
    { data: { id: '1', parent: 'g', status: 'up' } },
    { data: { id: '2', status: 'down' } },
    { data: { id: 'link_1', source: '1', target: '2' } },
] });
initVisibility(cy);
const state = { deviceLayers: new Map([[1, [10, 20]]]), linkLayers: new Map([[1, [10]]]), visibleLayerIds: [10] };
setLayerVisibility(state);
assert.equal(cy.$id('link_1').style('display'), 'element', 'initial refresh preserves the link');
setLayerVisibility({ ...state, visibleLayerIds: [] });
assert.equal(cy.$id('1').style('display'), 'none');
assert.equal(cy.$id('g').style('display'), 'none');
assert.equal(cy.$id('2').style('display'), 'element', 'unassigned device stays visible');
assert.equal(cy.$id('link_1').style('display'), 'none');
setLayerVisibility({ ...state, visibleLayerIds: [20] });
assert.equal(cy.$id('1').style('display'), 'element', 'membership uses OR');
setLayerVisibility(state);
cy.$id('g').data('collapsed', true);
cy.$id('link_1').data('_hiddenByCollapse', true);
applyMapVisibility();
assert.equal(cy.$id('1').style('display'), 'none');
assert.equal(cy.$id('link_1').style('display'), 'none', 'collapse proxies retain ownership of real edges');
const proxy = cy.add({ data: {
    id: 'proxy', source: 'g', target: '2', isCollapseProxy: true, originalEdgeIds: ['link_1'],
} });
applyMapVisibility();
assert.equal(proxy.style('display'), 'element');
setLayerVisibility({ ...state, visibleLayerIds: [20] });
assert.equal(cy.$id('g').style('display'), 'element', 'the other layer keeps the group visible');
assert.equal(proxy.style('display'), 'none', 'hidden originals cannot appear through a proxy');
proxy.remove();
setLayerVisibility(state);
cy.$id('g').removeData('collapsed');
cy.$id('link_1').removeData('_hiddenByCollapse');
applyMapVisibility();
assert.equal(cy.$id('link_1').style('display'), 'element');
cy.destroy();

// Exercise the actual panel handlers with controllable API responses.
const { http } = await import('../../static/js/src/utils/http.js');
const { initLayers, refreshLayers, cleanup } = await import('../../static/js/src/map/layers.js');
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const checkbox = {
    dataset: { layerVisible: '10' },
    addEventListener(_, handler) { this.change = handler; },
};
const orderControls = [[], []];
const actions = { append() {} };
const panel = {
    hidden: true,
    closest: () => null,
    querySelector: selector => selector === '.map-layers-actions' ? actions : null,
    querySelectorAll(selector) {
        if (selector === '.map-layer-controls') {
            return orderControls.map(buttons => {
                buttons.length = 0;
                return { prepend: button => buttons.unshift(button) };
            });
        }
        return selector.includes(':checked') ? [] : selector.includes('data-layer-visible') ? [checkbox] : [];
    },
};
const button = { addEventListener() {}, removeEventListener() {} };
Object.assign(window, { addEventListener() {}, removeEventListener() {} });
Object.assign(document, {
    getElementById: id => ({ mapLayersPanel: panel, layersToggle: button })[id],
    addEventListener() {}, removeEventListener() {},
    createElement: () => ({
        setAttribute() {},
        addEventListener(_, handler) { this.click = handler; },
    }),
});
globalThis.alert = () => {};
const layer = { id: 10, name: 'Core', device_ids: [], link_ids: [] };
const spare = { ...layer, id: 20, name: 'Backup' };
let serverLayers = [layer];
let confirmed = [10];
let reads = 0;
let heldVisibility;
http.get = async url => {
    reads++;
    if (url.endsWith('/layers')) return { layers: serverLayers };
    const held = heldVisibility;
    heldVisibility = null;
    return held ? held.promise : { visible_layer_ids: confirmed };
};
let write = deferred();
let writes = 0;
http.put = () => { writes++; return write.promise; };
initLayers(1);
await refreshLayers();
const checked = () => /data-layer-visible="10" checked/.test(panel.innerHTML);
assert.equal(checked(), true);
const originalReads = reads;
checkbox.change();
assert.equal(checkbox.disabled, true);
assert.equal(checked(), true, 'the panel keeps the confirmed state while saving');
checkbox.change();
assert.equal(writes, 1, 'a second click cannot overlap the save');
const socketRefresh = refreshLayers();
assert.equal(reads, originalReads, 'refresh waits for the active PUT');
write.reject(new Error('HTTP 500'));
await socketRefresh;
await refreshLayers();
assert.equal(checked(), true, 'the failed save leaves the layer enabled');
assert.equal(checkbox.disabled, false);
write = deferred();
const oldRead = deferred();
heldVisibility = oldRead;
const staleRefresh = refreshLayers();
checkbox.change();
confirmed = [];
write.resolve({ visible_layer_ids: confirmed });
await refreshLayers();
oldRead.resolve({ visible_layer_ids: [10] });
await staleRefresh;
assert.equal(checked(), false, 'the next save succeeds and refresh preserves it');
window.canEditMap = true;
serverLayers = [layer, spare];
await refreshLayers();
const down = () => orderControls[0].find(button => button.textContent === '↓');
http.put = async (url, payload) => {
    assert.equal(url, '/api/map/1/layers/order');
    assert.deepEqual(payload.layer_ids, [20, 10]);
    throw new Error('HTTP 403');
};
await down().click();
assert.ok(panel.innerHTML.indexOf('Core') < panel.innerHTML.indexOf('Backup'), 'order is unchanged on failure');
http.put = async () => { serverLayers = [spare, layer]; };
await down().click();
assert.ok(panel.innerHTML.indexOf('Backup') < panel.innerHTML.indexOf('Core'), 'server order is rendered after save');
cleanup();
console.log('layers integration tests passed');
