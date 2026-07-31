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

// Оптимизированное массовое обновление с троттлингом
export function updateAllGroups() {
    if (groupUpdateTimeout) return;

    groupUpdateTimeout = setTimeout(() => {
        const cy = getCy();
        if (!cy) return;
        
        // Обновляем все группы
        cy.nodes('node[isGroup]').forEach(group => {
            // Сначала сбрасываем размер
            group.style('width', null);
            group.style('height', null);
            // Затем принудительно вызываем обновление стиля
            group.emit('style');
        });
        
        // Принудительный пересчет layout
        cy.style().update();
        cy.resize();
        
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
    groups.forEach(g => {
        // Сбрасываем размер
        g.style('width', null);
        g.style('height', null);
        // Обновляем позицию (триггерит пересчёт)
        g.position(g.position());
    });
    
    cy.style().update();
    cy.resize();
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
