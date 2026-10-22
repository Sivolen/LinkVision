// groupResize.js
import { getCy } from './core.js';
import { registerCleanup } from './moduleRegistry.js';

let groupUpdateTimeout = null;
const GROUP_UPDATE_DELAY = 100;

export function updateGroupSize(groupNode) {
    if (!groupNode || !groupNode.length) return;
    if (groupNode.data('collapsed')) return; // Пропускаем свёрнутые группы
    groupNode.style('width', null);
    groupNode.style('height', null);
    groupNode.emit('style');
}

export function updateGroupsForNode(node) {
    if (!node || !node.length) return;
    const cy = getCy();
    if (!cy) return;
    // Поднимаемся по всей цепочке ancestors('[isGroup]'), а не только к ближайшему родителю
    node.ancestors('[isGroup]').forEach(parent => {
        updateGroupSize(parent);
    });
}

/** Пересчитать только группы-предки изменившихся узлов, снизу вверх. */
export function updateGroupsForNodes(nodes) {
    const cy = getCy();
    if (!cy || !nodes) return;

    const groups = new Map();
    nodes.forEach(node => {
        if (!node || !node.length) return;
        node.ancestors().filter('node[isGroup]').forEach(group => groups.set(group.id(), group));
    });

    const orderedGroups = Array.from(groups.values()).sort(
        (a, b) => b.ancestors().filter('node[isGroup]').length - a.ancestors().filter('node[isGroup]').length
    );
    cy.batch(() => orderedGroups.forEach(updateGroupSize));
}

// Оптимизированное массовое обновление с троттлингом
export function updateAllGroups() {
    if (groupUpdateTimeout) return;

    groupUpdateTimeout = setTimeout(() => {
        const cy = getCy();
        if (!cy) return;
        
        // Обновляем размеры групп одной пакетной операцией. Стили и размеры
        // обычных узлов не менялись, поэтому глобальный style().update() и
        // resize() здесь только повторно пересчитывали весь граф и viewport.
        cy.batch(() => {
            cy.nodes('node[isGroup]').forEach(updateGroupSize);
        });
        
        groupUpdateTimeout = null;
    }, GROUP_UPDATE_DELAY);
}

/** Принудительное обновление всех групп без debounce */
export function forceUpdateAllGroups() {
    const cy = getCy();
    if (!cy) return;
    
    // Очистить отложенное обновление
    if (groupUpdateTimeout) {
        clearTimeout(groupUpdateTimeout);
        groupUpdateTimeout = null;
    }
    
    // Рекурсивно обновляем все группы и их родителей
    const groups = cy.nodes('[isGroup]');
    cy.batch(() => {
        groups.forEach(g => {
            updateGroupSize(g);
            // Обновляем позицию (триггерит пересчёт compound-границ).
            g.position(g.position());
        });
    });

    console.log(`🔄 Force updated ${groups.length} groups`);
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
window.forceUpdateAllGroups = forceUpdateAllGroups;

// Саморегистрация в общем реестре очистки (см. moduleRegistry.js)
registerCleanup(cleanup);
