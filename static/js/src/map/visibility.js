// One owner for Cytoscape visibility. Filters and layers compose here instead
// of independently calling hide()/show() and undoing each other.
import { syncDeviceLabelVisibility } from './deviceLabels.js';
import { registerCleanup } from './moduleRegistry.js';

let cy = null;
let statusFilter = 'all';
let layerState = { deviceLayers: new Map(), linkLayers: new Map(), visible: null };

const statusMatches = node => statusFilter === 'all'
    || (statusFilter === 'quality' && ['bad', 'degraded'].includes(node.data('quality_status')))
    || (statusFilter === 'unmonitored' && node.data('monitoring_enabled') === 'false')
    || node.data('status') === statusFilter;

const belongsToVisibleLayer = ids => !ids?.length || ids.some(id => layerState.visible?.has(id));
const edgeAllowed = edge => belongsToVisibleLayer(layerState.linkLayers.get(Number(edge.id().replace(/^link_/, ''))))
    && deviceVisibleByRules(edge.source()) && deviceVisibleByRules(edge.target());
const deviceVisibleByRules = node => {
    const ids = layerState.deviceLayers.get(Number(node.id())) || [];
    return statusMatches(node) && belongsToVisibleLayer(ids);
};
// `_hiddenByCollapse` is a derived, temporary marker owned by groupCollapse.
// It may be stale while the graph is rebuilt, so visibility must derive the
// answer from the actual collapsed ancestors rather than trusting that marker.
const isInsideCollapsedGroup = node => node.ancestors('[?isGroup][?collapsed]').length > 0;

export function initVisibility(instance) { cleanupVisibility(); cy = instance; }
export function setStatusFilter(filter) { statusFilter = filter || 'all'; applyMapVisibility(); }
export function getStatusFilter() { return statusFilter; }
export function setLayerVisibility({ deviceLayers, linkLayers, visibleLayerIds }) {
    layerState = { deviceLayers: deviceLayers || new Map(), linkLayers: linkLayers || new Map(), visible: new Set(visibleLayerIds || []) };
    applyMapVisibility();
}

export function applyMapVisibility() {
    if (!cy || cy.destroyed()) return;
    const populatedGroups = new Set();
    const visibleGroups = new Set();
    // Walk each device's ancestor chain once. Avoid descendants() scans for
    // every group, especially expensive with nested compound groups.
    cy.nodes().forEach(node => {
        if (node.data('isGroup') || node.data('isShape')) return;
        const allowed = deviceVisibleByRules(node);
        node.ancestors().forEach(parent => {
            populatedGroups.add(parent.id());
            if (allowed) visibleGroups.add(parent.id());
        });
    });
    cy.batch(() => {
        cy.nodes().forEach(node => {
            if (node.data('isShape')) return node.show();
            if (node.data('isGroup')) {
                // A group with only hidden members must not remain as a
                // clickable empty container. Empty groups stay visible so a
                // user can still edit them.
                const hasVisibleMember = (!populatedGroups.has(node.id()) || visibleGroups.has(node.id())) && !isInsideCollapsedGroup(node);
                return hasVisibleMember ? node.show() : node.hide();
            }
            (deviceVisibleByRules(node) && !isInsideCollapsedGroup(node) ? node.show() : node.hide());
        });
        cy.edges().forEach(edge => {
            if (edge.data('isCollapseProxy')) {
                const allowed = (edge.data('originalEdgeIds') || [])
                    .map(id => cy.getElementById(id))
                    .filter(original => original.length && edgeAllowed(original));
                const first = allowed[0];
                if (first) {
                    const label = allowed.length === 1 ? first.data('label') : `× ${allowed.length}`;
                    if (edge.data('label') !== label) edge.data('label', label);
                    edge.show();
                } else {
                    edge.hide();
                }
                return;
            }
            // Evaluate the rules, since rendered visibility can be stale inside the batch.
            (edgeAllowed(edge) && !edge.data('_hiddenByCollapse') ? edge.show() : edge.hide());
        });
    });
    syncDeviceLabelVisibility();
    window.dispatchEvent(new CustomEvent('linkvision:map-filter-changed', { detail: { filtered: statusFilter !== 'all' } }));
}

export function cleanupVisibility() { cy = null; statusFilter = 'all'; layerState = { deviceLayers: new Map(), linkLayers: new Map(), visible: null }; }
registerCleanup(cleanupVisibility);
