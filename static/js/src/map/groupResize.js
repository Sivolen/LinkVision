// groupResize.js
import { getCy } from './core.js';

export function updateGroupSize(groupNode) {
    if (!groupNode || !groupNode.length) return;
    // Простой способ: сбросить стиль, чтобы Cytoscape пересчитал размер
    groupNode.style('width', null);
    groupNode.style('height', null);
    groupNode.emit('style');
}

export function updateGroupsForNode(node) {
    if (!node || !node.length) return;
    const cy = getCy();
    if (!cy) return;
    const parent = node.parent();
    if (parent.length && parent.data('isGroup')) {
        updateGroupSize(parent);
    }
}

export function updateAllGroups() {
    const cy = getCy();
    if (!cy) return;
    cy.nodes('node[isGroup]').forEach(group => updateGroupSize(group));
}