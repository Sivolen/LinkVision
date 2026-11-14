import assert from 'node:assert/strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const el = () => ({ style: {}, classList: { toggle() {} }, addEventListener() {}, removeEventListener() {}, clientWidth: 200, clientHeight: 120, removeAttribute() {} });
const inner = el(), img = el(), rect = el(), panel = el();
panel.querySelector = selector => ({ '.minimap-inner': inner, '.minimap-img': img, '.minimap-viewport': rect })[selector] || null;
globalThis.document = { getElementById: id => id === 'minimap' ? panel : null };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
const { initMinimap, cleanup } = await import('../../static/js/src/map/minimap.js');
const handlers = {};
const bounds = { x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 };
let snapshots = 0;
let boundsReads = 0;
let gesture = false;
let viewportReads = 0;
let viewportBounds = bounds;
const cy = {
  on(events, fn) { events.split(' ').forEach(event => handlers[event] = fn); }, off() {},
  nodes: () => ({ length: 0 }),
  elements: () => ({ length: 1, boundingBox: () => { boundsReads++; return bounds; } }),
  png(options) {
    assert.equal(options.output, 'blob-promise');
    snapshots++;
    return Promise.resolve(new Blob(['png'], { type: 'image/png' }));
  },
  extent: () => { viewportReads++; return viewportBounds; },
  renderer: () => ({ data: { wheelZooming: gesture } }),
};
initMinimap(cy);
await sleep(350);
assert.equal(snapshots, 1, 'initial snapshot should not wait for the throttle interval');
assert.equal(boundsReads, 1, 'world and snapshot share the same bounds');
const readsBefore = viewportReads;
const leftBefore = parseFloat(rect.style.left);
viewportBounds = { ...bounds, x1: 50 };
handlers.viewport();
assert.equal(viewportReads, readsBefore + 1);
assert.ok(parseFloat(rect.style.left) > leftBefore);
gesture = true;
handlers.data();
await sleep(400);
assert.equal(snapshots, 1, 'repeated updates should be throttled');
await sleep(1200);
assert.equal(snapshots, 1, 'do not capture a snapshot during a viewport gesture');
gesture = false;
handlers.viewport();
await sleep(350);
assert.equal(snapshots, 1, 'short pause after viewport motion should not start capture');
await sleep(450);
assert.equal(snapshots, 2, 'latest update should eventually be shown');
const url = img.src;
assert.ok(url.startsWith('blob:'));
cleanup();
await assert.rejects(fetch(url), 'cleanup releases the snapshot URL');
console.log('minimap initial rendering and throttled update passed');
