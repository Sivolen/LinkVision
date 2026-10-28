/** Tests for edge-interface label zoom visibility. */
import assert from 'node:assert/strict';
import {
    EDGE_LABEL_FULL_ZOOM,
    EDGE_LABEL_MIN_ZOOM,
    edgeLabelOpacity,
} from '../../static/js/src/map/labelScale.js';

assert.equal(edgeLabelOpacity(0.1), 0, 'labels are hidden at overview zoom');
assert.equal(edgeLabelOpacity(EDGE_LABEL_MIN_ZOOM), 0, 'fade starts smoothly');
assert.ok(
    Math.abs(edgeLabelOpacity((EDGE_LABEL_MIN_ZOOM + EDGE_LABEL_FULL_ZOOM) / 2) - 0.5) < 1e-12,
    'opacity interpolates linearly through the middle of the fade'
);
assert.equal(edgeLabelOpacity(EDGE_LABEL_FULL_ZOOM), 1, 'labels are fully visible after fade');
assert.equal(edgeLabelOpacity(2), 1, 'zooming in does not increase opacity further');
assert.equal(edgeLabelOpacity(Number.NaN), 0, 'invalid zoom does not produce visible labels');

console.log('edgeLabelScale tests passed');
