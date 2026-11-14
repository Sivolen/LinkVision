import assert from 'node:assert/strict';
import cytoscape from '../../static/js/cytoscape.min.js';
import {
    QUALITY_MEASUREMENTS_EVENT,
    updateQualityMeasurements,
} from '../../static/js/src/map/qualityMeasurements.js';

const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    elements: [
        { data: { id: 'group' } },
        { data: { id: 'router', parent: 'group', quality_status: 'good' } },
        { data: { id: 'switch' }, position: { x: 100, y: 50 } },
        { data: { id: 'link', source: 'router', target: 'switch' } },
    ],
    style: [{ selector: 'node[quality_status="bad"]', style: { 'border-width': 4 } }],
});
const node = cy.getElementById('router');
cy.elements().boundingBox();
let invalidations = 0;
let updates = 0;
cy.on('data style bounds', () => { invalidations++; });
cy.on(QUALITY_MEASUREMENTS_EVENT, 'node', event => {
    assert.equal(event.target, node);
    updates++;
});

const sample = { quality_latency_ms: 13, quality_loss_percent: 0, quality_jitter_ms: 2 };
cy.batch(() => updateQualityMeasurements(node, sample));
assert.equal(node.data('quality_latency_ms'), 13);
assert.equal(node.data('quality_loss_percent'), 0);
assert.equal(updates, 1);
updateQualityMeasurements(node, sample);
assert.equal(updates, 1);
updateQualityMeasurements(node);
assert.equal(node.data('quality_jitter_ms'), null);
assert.equal(updates, 2);
cy.elements().boundingBox();
assert.equal(invalidations, 0, 'numeric telemetry must not invalidate the compound graph');

node.data('quality_status', 'bad');
assert.equal(parseFloat(node.style('border-width')), 4);
assert.ok(invalidations > 0, 'a real status change must still update styles');
cy.destroy();
console.log('quality measurements update the inspector without invalidating graph bounds');
