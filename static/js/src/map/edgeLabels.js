// edgeLabels.js – обновление подписей рёбер в зависимости от позиций узлов
import { getCy } from './core.js';

let updateTimeout = null;
const UPDATE_DELAY = 100; // задержка для пакетного обновления

export function updateEdgeLabel(edge) {
    if (!edge || edge.length === 0) return;
    const sourceNode = edge.source();
    const targetNode = edge.target();
    if (!sourceNode.length || !targetNode.length) return;

    const srcX = sourceNode.position().x;
    const tgtX = targetNode.position().x;
    const srcIface = edge.data('srcIface') || 'eth0';
    const tgtIface = edge.data('tgtIface') || 'eth0';

    let label;
    if (srcX <= tgtX) {
        label = `${srcIface} ↔ ${tgtIface}`;
    } else {
        label = `${tgtIface} ↔ ${srcIface}`;
    }
    edge.data('label', label);
    edge.emit('style');
}

export function updateEdgeLabelsForNode(node) {
    if (!node || node.length === 0) return;
    const cy = getCy();
    if (!cy) return;
    const connectedEdges = node.connectedEdges();
    connectedEdges.forEach(edge => updateEdgeLabel(edge));
}

// Оптимизированное массовое обновление с троттлингом
export function updateAllEdgeLabels() {
    if (updateTimeout) return; // Защита от частых вызовов

    updateTimeout = setTimeout(() => {
        const cy = getCy();
        if (!cy) return;

        // Используем batch для оптимизации
        cy.batch(() => {
            cy.edges().forEach(edge => updateEdgeLabel(edge));
        });

        updateTimeout = null;
    }, UPDATE_DELAY);
}