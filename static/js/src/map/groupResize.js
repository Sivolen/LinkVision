// groupResize.js
import { getCy } from './core.js';

let groupUpdateTimeout = null;
const GROUP_UPDATE_DELAY = 100;

export function updateGroupSize(groupNode) {
    if (!groupNode || !groupNode.length) return;
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

// Оптимизированное массовое обновление с троттлингом
export function updateAllGroups() {
    if (groupUpdateTimeout) return;

    groupUpdateTimeout = setTimeout(() => {
        const cy = getCy();
        if (!cy) return;
        cy.nodes('node[isGroup]').forEach(group => updateGroupSize(group));
        groupUpdateTimeout = null;
    }, GROUP_UPDATE_DELAY);
}

/**
 * Очистка таймеров при перезагрузке карты
 */
export function cleanup() {
    if (groupUpdateTimeout) {
        clearTimeout(groupUpdateTimeout);
        groupUpdateTimeout = null;
    }
}

window.updateAllGroups = updateAllGroups;