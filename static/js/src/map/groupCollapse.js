// groupCollapse.js – логика сворачивания групп в «пузырёк»
// Поддержка вложенных групп: при сворачивании родителя состояние дочерних
// групп (свёрнута/развернута) сохраняется и восстанавливается точно.
import { getCy } from './core.js';
import { updateAllGroups } from './groupResize.js';
import { refreshZoomEmphasis } from './zoomEmphasis.js';

const COLLAPSE_STORAGE_KEY = 'groupCollapseState';

// ─── Агрегация статуса ──────────────────────────────────────────────────

export function aggregateGroupStatus(groupNode) {
    if (!groupNode || !groupNode.length) return 'up';

    const devices = groupNode.descendants().filter(
        n => !n.data('isGroup') && !n.data('isShape')
    );

    let worst = 'up';
    let anyMonitored = false;

    devices.forEach(dev => {
        const raw = dev.data('monitoring_enabled');
        const monitoringOn = raw === true || raw === 'true';
        if (!monitoringOn) return;

        anyMonitored = true;
        const status = dev.data('status');
        if ((status === 'down') || (status === 'partial' && worst !== 'down')) {
            worst = status;
        }
    });

    return anyMonitored ? worst : 'up';
}

export function saveCollapseState() {
    const cy = getCy();
    if (!cy) return;
    const collapsed = [];
    cy.nodes('[isGroup][collapsed]').forEach(n => collapsed.push(n.id()));
    try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapsed));
    } catch (e) { /* ignore */ }
}

export function restoreCollapseState() {
    const cy = getCy();
    if (!cy) return;
    let collapsedIds = [];
    try {
        const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
        if (raw) collapsedIds = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    
    if (!collapsedIds.length) return;
    
    // Сортируем от корня к листьям
    collapsedIds.sort((a, b) => {
        const nodeA = cy.getElementById(a);
        const nodeB = cy.getElementById(b);
        if (!nodeA.length || !nodeB.length) return 0;
        return nodeA.ancestors('[isGroup]').length - nodeB.ancestors('[isGroup]').length;
    });

    collapsedIds.forEach(id => {
        const groupNode = cy.getElementById(id);
        if (groupNode.length && !groupNode.data('collapsed')) {
            collapseGroup(groupNode);
        }
    });
}

/**
 * Создать прокси-рёбра для одной группы.
 * @param {cytoscape.Element} groupNode
 * @param {Set<string>} descendantIds – ID всех потомков (включая детей группы)
 */
function createProxyEdges(groupNode, descendantIds) {
    const cy = getCy();
    if (!cy) return;
    
    const allEdges = cy.edges();
    allEdges.forEach(e => {
        if (e.data('isCollapseProxy')) return;
        
        const src = e.source();
        const tgt = e.target();
        const srcInside = src.id() === groupNode.id() || descendantIds.has(src.id());
        const tgtInside = tgt.id() === groupNode.id() || descendantIds.has(tgt.id());
        
        if (srcInside && !tgtInside) {
            const proxyId = `proxy_${e.id()}`;
            if (!cy.getElementById(proxyId).length) {
                cy.add({
                    group: 'edges',
                    data: {
                        id: proxyId,
                        source: groupNode.id(),
                        target: tgt.id(),
                        isCollapseProxy: true,
                        label: e.data('label'),
                        font_size: e.data('font_size'),
                        color: e.data('color'),
                        width: e.data('width'),
                        style: 'dashed'
                    }
                });
            }
        } else if (!srcInside && tgtInside) {
            const proxyId = `proxy_${e.id()}`;
            if (!cy.getElementById(proxyId).length) {
                cy.add({
                    group: 'edges',
                    data: {
                        id: proxyId,
                        source: src.id(),
                        target: groupNode.id(),
                        isCollapseProxy: true,
                        label: e.data('label'),
                        font_size: e.data('font_size'),
                        color: e.data('color'),
                        width: e.data('width'),
                        style: 'dashed'
                    }
                });
            }
        }
    });
}

// ─── Сворачивание ────────────────────────────────────────────────────────

export function collapseGroup(groupNode) {
    console.log('collapseGroup called for:', groupNode.id());
    if (!groupNode || groupNode.data('collapsed')) {
        console.log('Group already collapsed or invalid');
        return;
    }
    const cy = getCy();
    if (!cy) {
        console.warn('No cy instance');
        return;
    }
    
    console.log('Collapsing group:', groupNode.data('name'));
    
    // ★★★ СОХРАНЯЕМ СОСТОЯНИЕ ВСЕХ ДОЧЕРНИХ ГРУПП (рекурсивно) ★★★
    const childGroupsState = {};
    const allDescendants = groupNode.descendants();
    
    allDescendants.forEach(d => {
        if (d.data('isGroup')) {
            const isCollapsed = d.data('collapsed') || false;
            childGroupsState[d.id()] = isCollapsed;
            console.log(`  Child ${d.id()} (${d.data('name')}) collapsed: ${isCollapsed}`);
        }
    });
    
    groupNode.data('_childGroupsState', childGroupsState);
    console.log('Saved child states:', Object.keys(childGroupsState).length, 'groups');
    
    groupNode.data('collapsed', true);
    
    // Скрываем всех потомков
    allDescendants.forEach(d => d.hide());
    
    // Создаём прокси-рёбра
    const descendantIds = new Set(allDescendants.map(d => d.id()));
    createProxyEdges(groupNode, descendantIds);
    
    // Обновляем стиль и статус
    groupNode.style('width', 150);
    groupNode.style('height', 60);
    updateGroupStatusBubble(groupNode);
    saveCollapseState();
    updateAllGroups();
    refreshZoomEmphasis();
}

// ─── Разворачивание ──────────────────────────────────────────────────────

export function expandGroup(groupNode) {
    console.log('expandGroup called for:', groupNode.id());
    if (!groupNode || !groupNode.data('collapsed')) {
        console.log('Group not collapsed or invalid');
        return;
    }
    const cy = getCy();
    if (!cy) {
        console.warn('No cy instance');
        return;
    }
    console.log('Expanding group:', groupNode.data('name'));
    
    // Получаем сохранённое состояние дочерних групп
    const childGroupsState = groupNode.data('_childGroupsState') || {};
    console.log('Restoring child states:', Object.keys(childGroupsState).length, 'groups');
    
    groupNode.data('collapsed', false);
    
    // Удаляем прокси-рёбра, связанные с этой группой
    cy.edges('[isCollapseProxy]').forEach(e => {
        if (e.source().id() === groupNode.id() || e.target().id() === groupNode.id()) {
            console.log('  Removing proxy edge:', e.id());
            e.remove();
        }
    });
    
    // Показываем всех потомков
    const allDescendants = groupNode.descendants();
    allDescendants.forEach(d => d.show());
    
    // ★★★ Восстанавливаем каждую дочернюю группу в ТОЧНО то состояние ★★★
    Object.keys(childGroupsState).forEach(childId => {
        const childGroup = cy.getElementById(childId);
        if (!childGroup.length) return;
        
        const wasCollapsed = childGroupsState[childId];
        console.log(`  Restoring child ${childId} (${childGroup.data('name')}): collapsed=${wasCollapsed}`);
        
        if (wasCollapsed) {
            // Группа была свернута — сворачиваем её снова
            childGroup.data('collapsed', true);
            
            // Скрываем её потомков
            const childDescendants = childGroup.descendants();
            childDescendants.forEach(d => d.hide());
            
            // Создаём прокси-рёбра для дочерней группы
            const childDescendantIds = new Set(childDescendants.map(d => d.id()));
            childDescendantIds.add(childGroup.id());
            
            const allEdges = cy.edges();
            allEdges.forEach(e => {
                if (e.data('isCollapseProxy')) return;
                
                const src = e.source();
                const tgt = e.target();
                const srcInside = childDescendantIds.has(src.id());
                const tgtInside = childDescendantIds.has(tgt.id());
                
                if (srcInside && !tgtInside) {
                    const proxyId = `proxy_${e.id()}_${childGroup.id()}`;
                    if (!cy.getElementById(proxyId).length) {
                        cy.add({
                            group: 'edges',
                            data: {
                                id: proxyId,
                                source: childGroup.id(),
                                target: tgt.id(),
                                isCollapseProxy: true,
                                label: e.data('label'),
                                font_size: e.data('font_size'),
                                color: e.data('color'),
                                width: e.data('width'),
                                style: 'dashed'
                            }
                        });
                    }
                } else if (!srcInside && tgtInside) {
                    const proxyId = `proxy_${e.id()}_${childGroup.id()}`;
                    if (!cy.getElementById(proxyId).length) {
                        cy.add({
                            group: 'edges',
                            data: {
                                id: proxyId,
                                source: src.id(),
                                target: childGroup.id(),
                                isCollapseProxy: true,
                                label: e.data('label'),
                                font_size: e.data('font_size'),
                                color: e.data('color'),
                                width: e.data('width'),
                                style: 'dashed'
                            }
                        });
                    }
                }
            });
            
            // Стиль пузырька
            childGroup.style('width', 150);
            childGroup.style('height', 60);
            updateGroupStatusBubble(childGroup);
            
        } else {
            // Группа была развернута — убеждаемся, что она развернута
            childGroup.data('collapsed', false);
            childGroup.style('width', null);
            childGroup.style('height', null);
            childGroup.removeStyle('border-color border-style border-width');
            
            // Показываем всех её потомков (они уже show() выше, но на всякий случай)
            const childDescendants = childGroup.descendants();
            childDescendants.forEach(d => d.show());
        }
    });
    
    // Очищаем сохранённое состояние
    groupNode.removeData('_childGroupsState');
    
    // Восстанавливаем обычные рёбра
    cy.edges().forEach(e => {
        if (e.data('isCollapseProxy')) return;
        const src = e.source();
        const tgt = e.target();
        if (src.visible() && tgt.visible()) {
            e.show();
        } else {
            e.hide();
        }
    });
    
    // Сбрасываем фиксированный размер родительской группы
    groupNode.style('width', null);
    groupNode.style('height', null);
    groupNode.removeStyle('border-color border-style border-width');
    
    updateGroupStatusBubble(groupNode);
    saveCollapseState();
    updateAllGroups();
    refreshZoomEmphasis();
    
    console.log('Expanded group with restored child states');
}

// ─── Статус пузырька ─────────────────────────────────────────────────────

function updateGroupStatusBubble(groupNode) {
    const cy = getCy();
    if (!cy) return;
    
    const descendants = groupNode.descendants();
    let worstStatus = 'up';
    
    descendants.forEach(d => {
        if (d.data('isGroup')) return;
        const mon = d.data('monitoring_enabled');
        if (mon === 'false' || mon === false) return;
        
        const status = d.data('status');
        if (status === 'down') {
            worstStatus = 'down';
        } else if (status === 'partial' && worstStatus !== 'down') {
            worstStatus = 'partial';
        }
    });
    
    groupNode.data('bubbleStatus', worstStatus);
    groupNode.style('border-color', worstStatus === 'down' ? '#dc3545' : worstStatus === 'partial' ? '#ffc107' : '#28a745');
    groupNode.style('border-style', 'solid');
    groupNode.style('border-width', '3px');
    cy.style().update();
}

export function refreshAllCollapsedStatuses() {
    const cy = getCy();
    if (!cy) return;
    cy.nodes('[isGroup][collapsed]').forEach(n => updateGroupStatusBubble(n));
}

// ─── Экспорт для глобального доступа ──────────────────────────────────────

window.collapseGroup = collapseGroup;
window.expandGroup = expandGroup;
window.refreshAllCollapsedStatuses = refreshAllCollapsedStatuses;

/** Отладка: состояние всех групп */
window.debugCollapse = function() {
    const cy = getCy();
    if (!cy) return;
    console.log('=== Collapse Debug ===');
    cy.nodes('[isGroup]').forEach(g => {
        const collapsed = g.data('collapsed') ? 'YES' : 'NO';
        const children = g.children().length;
        const hidden = g.descendants().filter(d => !d.visible()).length;
        console.log(`${g.id()} "${g.data('name')}" collapsed: ${collapsed}, children: ${children}, hidden descendants: ${hidden}`);
    });
    console.log('=== End ===');
};

/** Отладка: детальные состояния дочерних групп */
window.debugCollapseState = function() {
    const cy = getCy();
    if (!cy) return;
    console.log('=== Collapse State Debug ===');
    cy.nodes('[isGroup]').forEach(g => {
        const collapsed = g.data('collapsed') ? '🔴 Свернута' : '🟢 Развернута';
        const children = g.children().length;
        const hidden = g.descendants().filter(d => !d.visible()).length;
        const childState = g.data('_childGroupsState') || {};
        const childCount = Object.keys(childState).length;
        console.log(`${g.id()} "${g.data('name')}" - ${collapsed}, детей: ${children}, скрыто: ${hidden}, сохранено дочерних: ${childCount}`);
        if (childCount > 0) {
            Object.keys(childState).forEach(id => {
                console.log(`  └─ ${id}: ${childState[id] ? 'свернута' : 'развернута'}`);
            });
        }
    });
    console.log('=== End ===');
};
