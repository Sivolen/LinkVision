import assert from 'node:assert/strict';
import cytoscape from '../../static/js/cytoscape.min.js';

const { drawLayeredElements } = cytoscape('renderer', 'canvas').prototype;
const calls = [];
const context = { drawImage: (...args) => calls.push(args) };
const canvas = { width: 2000, height: 1000 };
const layer = { canvas, bb: { x1: -100, y1: 50, x2: 900, y2: 550, w: 1000, h: 500 } };
const offscreen = { canvas, bb: { x1: 1000, y1: 50, x2: 2000, y2: 550, w: 1000, h: 500 } };
const renderer = {
    NODE: 0,
    data: { contexts: [context], lyrTxrCache: { getLayers: () => [layer, offscreen] } },
};
const viewport = { x1: 0, y1: 150, x2: 200, y2: 250 };
drawLayeredElements.call(renderer, context, [], 2, viewport);
assert.deepEqual(calls.splice(0), [
    [canvas, 199, 199, 402, 202, -0.5, 149.5, 201, 101],
]);

renderer.data.lyrTxrCache.getLayers = () => [layer];
drawLayeredElements.call(renderer, context, [], 2, { x1: -200, y1: 0, x2: 1000, y2: 600 });
assert.deepEqual(calls.splice(0), [[canvas, -100, 50, 1000, 500]]);

const exportContext = { drawImage: context.drawImage };
drawLayeredElements.call(renderer, exportContext, [], 2, viewport);
assert.deepEqual(calls.splice(0), [[canvas, -100, 50, 1000, 500]]);

renderer.data.lyrTxrCache.getLayers = () => null;
renderer.drawCachedElements = (...args) => calls.push(args);
const elements = [{}];
drawLayeredElements.call(renderer, context, elements, 2, viewport);
assert.deepEqual(calls, [[context, elements, 2, viewport]]);
console.log('Cytoscape crops visible screen layers and preserves full and fallback draws');
