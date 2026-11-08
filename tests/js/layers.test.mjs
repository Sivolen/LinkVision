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
cy.$id('g').removeData('collapsed');
cy.$id('link_1').removeData('_hiddenByCollapse');
applyMapVisibility();
assert.equal(cy.$id('link_1').style('display'), 'element');
cy.destroy();
console.log('layers integration tests passed');
