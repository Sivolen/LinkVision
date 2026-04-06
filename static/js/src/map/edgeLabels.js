// edgeLabels.js – обновление подписей рёбер в зависимости от позиций узлов
import { getCy } from './core.js';

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
    // принудительно обновляем стиль (чтобы текст перерисовался)
    edge.emit('style');
}

export function updateEdgeLabelsForNode(node) {
    if (!node || node.length === 0) return;
    const cy = getCy();
    if (!cy) return;
    const connectedEdges = node.connectedEdges();
    connectedEdges.forEach(edge => updateEdgeLabel(edge));
}

export function updateAllEdgeLabels() {
    const cy = getCy();
    if (!cy) return;
    cy.edges().forEach(edge => updateEdgeLabel(edge));
}