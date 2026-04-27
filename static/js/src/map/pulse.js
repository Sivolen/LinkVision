// pulse.js – пульсация для down (красная) и partial (жёлтая)
let pulsingNodesRed = new Set();
let pulsingNodesYellow = new Set();
let pulseInterval = null;
let pulsePhase = 0;
const pulseStep = 0.015;
const minOpacity = 0.15;
const maxOpacity = 0.45;

export function initPulse(cy) {}

export function addPulsingNode(cy, node, type = 'down') {
    const id = node.id();
    if (type === 'down') {
        if (!pulsingNodesRed.has(id)) {
            pulsingNodesRed.add(id);
            pulsingNodesYellow.delete(id);
            node.style('overlay-color', '#dc3545');
        }
    } else if (type === 'partial') {
        if (!pulsingNodesYellow.has(id)) {
            pulsingNodesYellow.add(id);
            pulsingNodesRed.delete(id);
            node.style('overlay-color', '#ffc107');
        }
    }
    if (!pulseInterval && (pulsingNodesRed.size > 0 || pulsingNodesYellow.size > 0)) {
        pulsePhase = 0;
        pulseInterval = setInterval(() => {
            pulsePhase += pulseStep;
            if (pulsePhase > 1) pulsePhase -= 2;
            const opacity = minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));
            pulsingNodesRed.forEach(nid => {
                const n = cy.getElementById(nid);
                if (n.length) n.style('overlay-opacity', opacity);
            });
            pulsingNodesYellow.forEach(nid => {
                const n = cy.getElementById(nid);
                if (n.length) n.style('overlay-opacity', opacity);
            });
        }, 50);
    }
}

export function removePulsingNode(cy, node) {
    const id = node.id();
    pulsingNodesRed.delete(id);
    pulsingNodesYellow.delete(id);
    node.style('overlay-opacity', null);
    node.style('overlay-color', null);
    if (pulsingNodesRed.size === 0 && pulsingNodesYellow.size === 0 && pulseInterval) {
        clearInterval(pulseInterval);
        pulseInterval = null;
    }
}
// Принудительно удалить узел из пульсации (по ID)
export function forceRemovePulsingNode(cy, nodeId) {
    if (pulsingNodesRed.has(nodeId)) pulsingNodesRed.delete(nodeId);
    if (pulsingNodesYellow.has(nodeId)) pulsingNodesYellow.delete(nodeId);
    const node = cy.getElementById(nodeId);
    if (node.length) {
        node.style('overlay-opacity', null);
        node.style('overlay-color', null);
    }
    if (pulsingNodesRed.size === 0 && pulsingNodesYellow.size === 0 && pulseInterval) {
        clearInterval(pulseInterval);
        pulseInterval = null;
    }
}
export function stopAllPulsing() {
    if (pulseInterval) {
        clearInterval(pulseInterval);
        pulseInterval = null;
    }
    pulsingNodesRed.clear();
    pulsingNodesYellow.clear();
}
window.stopAllPulsing = stopAllPulsing;
window.forceRemovePulsingNode = forceRemovePulsingNode;
window.addPulsingNode = addPulsingNode;
window.removePulsingNode = removePulsingNode;