import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { reloadMapWithViewportRestore } from '../../static/js/src/modal/mapIntegration.js';

const window = {};
const document = {
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
};
const context = createContext({ window, document, console, setTimeout, clearTimeout });
const loadBundle = name => {
    const file = new URL(`../../static/js/dist/${name}.min.js`, import.meta.url);
    runInContext(readFileSync(file, 'utf8'), context, { filename: file.pathname });
};

loadBundle('map');
const handlers = ['setMode', 'startLinkMode', 'resetLinkMode', 'withViewportRestore'];
const original = handlers.map(name => window[name]);
original.forEach(handler => assert.equal(typeof handler, 'function'));
loadBundle('modal');
handlers.forEach((name, index) => {
    assert.equal(window[name], original[index], `modal bundle replaced ${name}`);
});

const calls = [];
globalThis.window = {
    reloadMapElements: async () => {
        await Promise.resolve();
        calls.push('reload');
    },
    withViewportRestore: async callback => {
        calls.push('save viewport');
        await callback();
        calls.push('restore viewport');
    },
};
try {
    await reloadMapWithViewportRestore();
    assert.deepEqual(calls, ['save viewport', 'reload', 'restore viewport']);
} finally {
    delete globalThis.window;
}
console.log('Map and modal bundles preserve map handlers and share viewport restoration');
