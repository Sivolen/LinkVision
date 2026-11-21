import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { initPortalStatuses } from '../../static/js/src/map/portalStatuses.js';
import { CY_STYLE } from '../../static/js/src/map/styles.js';

const require = createRequire(import.meta.url);
const cytoscape = require('../../static/js/cytoscape.min.js');
globalThis.document = new EventTarget();
document.hidden = false;
let theme = 'light';
document.documentElement = { getAttribute: () => theme };
const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    style: CY_STYLE.filter(({ selector }) => (
        selector.startsWith('node[isShape]') || selector.startsWith('node[shape_type')
        || selector.startsWith('node.portal-')
    )),
});
const timers = new Map();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let nextTimer = 0;
globalThis.setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
};
globalThis.clearTimeout = id => timers.delete(id);
const requests = [];
globalThis.fetch = (url, options) => new Promise(resolve => {
    requests.push({ url, signal: options.signal, resolve });
});

function runTimer(delay) {
    const [id, { callback }] = [...timers].find(([, timer]) => timer.delay === delay);
    timers.delete(id);
    return callback();
}

function reply(request, statuses) {
    request.resolve({ ok: true, json: async () => ({ statuses }) });
}

const first = cy.add({ data: {
    id: 'shape_1', isShape: true, shape_type: 'map_link', target_map_id: 9,
    width: 96, height: 96, color: '#3498db', opacity: 1, label: 'Branch', fontSize: 12,
} });
const cleanup = initPortalStatuses(cy, 3);
try {
    assert.equal(first.style('background-color'), 'rgb(226,232,240)');
    const initial = runTimer(100);
    assert.equal(requests[0].url, '/api/map/3/portal-statuses');
    reply(requests[0], { 9: 'down' });
    await initial;
    assert.equal(first.style('border-color'), 'rgb(220,38,38)');
    assert.equal(first.style('background-color'), 'rgb(254,226,226)');
    first.select();
    assert.equal(first.style('background-color'), 'rgb(254,226,226)');
    theme = 'dark';
    cy.style().update();
    assert.equal(first.style('border-color'), 'rgb(248,113,113)');
    assert.equal(first.style('background-color'), 'rgb(84,44,54)');

    const poll = runTimer(15_000);
    reply(requests[1], { 9: 'clear' });
    await poll;
    assert.equal(first.hasClass('portal-down'), false);
    assert.equal(first.style('border-color'), 'rgb(74,222,128)');
    assert.equal(first.style('background-color'), 'rgb(32,60,48)');
    theme = 'light';
    cy.style().update();
    assert.equal(first.style('border-color'), 'rgb(21,128,61)');
    assert.equal(first.style('background-color'), 'rgb(220,252,231)');
    first.unselect();

    const stale = runTimer(15_000);
    first.data('target_map_id', 12);
    assert.equal(requests[2].signal.aborted, true);
    assert.equal(first.hasClass('portal-clear'), false);
    reply(requests[2], { 9: 'clear', 12: 'down' });
    await stale;
    assert.equal(first.hasClass('portal-down'), false);

    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(timers.size, 0);
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    const visible = runTimer(100);
    reply(requests[3], { 12: 'down' });
    await visible;
    assert.equal(first.hasClass('portal-down'), true);

    const revoked = runTimer(15_000);
    reply(requests[4], {});
    await revoked;
    assert.equal(first.hasClass('portal-down'), false);
    first.remove();
    assert.equal(timers.size, 0);
} finally {
    cleanup();
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    cy.destroy();
}

console.log('Map portal statuses passed');
