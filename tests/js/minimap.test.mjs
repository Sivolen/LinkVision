import assert from 'node:assert/strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const el = () => ({ style: {}, classList: { toggle() {} }, addEventListener() {}, removeEventListener() {}, clientWidth: 200, clientHeight: 120, removeAttribute() {} });
const inner = el(), img = el(), rect = el(), panel = el();
panel.querySelector = selector => ({ '.minimap-inner': inner, '.minimap-img': img, '.minimap-viewport': rect })[selector] || null;
globalThis.document = { getElementById: id => id === 'minimap' ? panel : null };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.requestAnimationFrame = callback => { callback(); return 1; };
const { initMinimap, cleanup } = await import('../../static/js/src/map/minimap.js');
const handlers = {};
const bounds = { x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 };
let snapshots = 0;
const cy = {
  on(events, fn) { events.split(' ').forEach(event => handlers[event] = fn); }, off() {},
  nodes: () => ({ length: 0 }), elements: () => ({ length: 1, boundingBox: () => bounds }),
  forceRender() {}, png() { snapshots++; return 'data:image/png;base64,AA=='; },
  extent: () => bounds,
};
initMinimap(cy);
await sleep(350);
assert.equal(snapshots, 1, 'initial snapshot should not wait for the throttle interval');
handlers.data();
await sleep(400);
assert.equal(snapshots, 1, 'repeated updates should be throttled');
await sleep(1200);
assert.equal(snapshots, 2, 'latest update should eventually be shown');
cleanup();
console.log('minimap initial rendering and throttled update passed');
