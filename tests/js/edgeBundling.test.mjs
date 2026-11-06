import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { getElementById() { return null; } };
const require = createRequire(import.meta.url);
const cytoscape = require('../../static/js/cytoscape.min.js');
const { recomputeEdgeCurves, cleanup } = await import('../../static/js/src/map/edgeBundling.js');
const cy = cytoscape({ headless: true, styleEnabled: true, elements: [
  { data: { id: 'a' }, position: { x: 0, y: 0 } },
  { data: { id: 'b' }, position: { x: 100, y: 0 } },
  { data: { id: 'c' }, position: { x: 100, y: 4 } },
  { data: { id: 'ab', source: 'a', target: 'b' } },
  { data: { id: 'ac', source: 'a', target: 'c' } },
], layout: { name: 'preset' } });
recomputeEdgeCurves(cy);
const ab = cy.$id('ab'), ac = cy.$id('ac');
assert.equal(ab.style('curve-style'), 'unbundled-bezier');
assert.equal(ac.style('curve-style'), 'unbundled-bezier');
let changes = 0;
cy.on('style', 'edge', () => changes++);
recomputeEdgeCurves(cy);
assert.equal(changes, 0, 'unchanged curves must not trigger restyling');
cy.$id('c').position({ x: 0, y: 100 });
recomputeEdgeCurves(cy);
assert.notEqual(ab.style('curve-style'), 'unbundled-bezier');
assert.notEqual(ac.style('curve-style'), 'unbundled-bezier');
cleanup();
cy.destroy();
console.log('edge bundling: unchanged curves and changed topology passed');
