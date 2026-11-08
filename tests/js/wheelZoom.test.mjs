import assert from 'node:assert/strict';

let handler;
globalThis.document = {
    addEventListener(type, fn) { if (type === 'wheel') handler = fn; },
    removeEventListener(type, fn) { if (type === 'wheel' && handler === fn) handler = null; },
    getElementById() { return null; },
    body: { style: {} },
};
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
const { initModes, setMode, isWheelZoomActive } = await import('../../static/js/src/map/modes.js');
const { cleanupAll } = await import('../../static/js/src/map/moduleRegistry.js');
const target = {};
const container = { contains: el => el === target, getBoundingClientRect: () => ({ left: 10, top: 20, height: 500 }) };
let zoom = 1, panning = true, result;
const cy = {
    container: () => container, zoomingEnabled: () => true, userZoomingEnabled: () => true,
    zoom(value) { if (!value) return zoom; result = value; zoom = value.level; },
    panningEnabled(value) { if (value === undefined) return panning; panning = value; },
    userPanningEnabled() {}, boxSelectionEnabled() {}, autounselectify() {},
    style: () => ({ update() {} }),
};
initModes(cy);
function wheel(deltaY, deltaMode = 0, node = target) {
    const event = { target: node, deltaY, deltaMode, clientX: 40, clientY: 70,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    handler(event);
    return event;
}
const first = wheel(-102);
assert.ok(first.prevented && first.stopped);
assert.ok(zoom > 1 && zoom < 1.04, 'Firefox wheel step must remain small');
assert.deepEqual(result.renderedPosition, { x: 30, y: 50 });
assert.ok(isWheelZoomActive());
setMode('select');
assert.equal(panning, false);
const second = wheel(102);
assert.ok(second.prevented && second.stopped);
assert.ok(Math.abs(zoom - 1) < 1e-10);
assert.equal(panning, false, 'box selection must keep panning disabled');
assert.equal(wheel(1, 0, {}).prevented, undefined, 'outside map is untouched');
const before = zoom;
wheel(-3, 1);
assert.ok(zoom > before && zoom / before < 1.04, 'line deltas are normalized');
cleanupAll();
assert.equal(handler, null);
assert.equal(isWheelZoomActive(), false);
console.log('wheel zoom: Firefox, modes, cursor and cleanup passed');
