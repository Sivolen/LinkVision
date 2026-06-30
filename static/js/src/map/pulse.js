// pulse.js – пульсация для down (красная) и partial (жёлтая) с таймаутом 30 секунд
let pulsingNodes = new Map(); // id -> { type, timeoutId }
let pulseInterval = null;
let pulsePhase = 0;
const pulseStep = 0.025;
const minOpacity = 0.15;
const maxOpacity = 0.45;
const PULSE_DURATION = 30000; // 30 секунд
const PULSE_INTERVAL_MS = 100; // Увеличено с 50мс для производительности

export function initPulse(cy) {}

export function addPulsingNode(cy, node, type = 'down') {
    const id = node.id();
    const existing = pulsingNodes.get(id);

    // Если уже пульсирует с таким же типом, ничего не делаем
    if (existing && existing.type === type) return;

    // Останавливаем старую пульсацию для этого узла
    if (existing) {
        clearTimeout(existing.timeoutId);
        pulsingNodes.delete(id);
        node.style('overlay-opacity', null);
    }

    const overlayColor = (type === 'down') ? '#dc3545' : '#ffc107';
    node.style('overlay-color', overlayColor);
    node.style('overlay-opacity', minOpacity);

    pulsingNodes.set(id, {
        type: type,
        timeoutId: setTimeout(() => {
            const nodeData = pulsingNodes.get(id);
            if (nodeData) {
                pulsingNodes.delete(id);
                const n = cy.getElementById(id);
                if (n.length) {
                    n.style('overlay-opacity', null);
                    n.style('overlay-color', null);
                }
                if (pulsingNodes.size === 0 && pulseInterval) {
                    clearInterval(pulseInterval);
                    pulseInterval = null;
                }
            }
        }, PULSE_DURATION)
    });

    if (!pulseInterval && pulsingNodes.size > 0) {
        pulsePhase = 0;
        pulseInterval = setInterval(() => {
            pulsePhase += pulseStep;
            if (pulsePhase > 1) pulsePhase -= 2;
            const opacity = minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));

            cy.batch(() => {
                pulsingNodes.forEach((data, nodeId) => {
                    const n = cy.getElementById(nodeId);
                    if (n.length) {
                        n.style('overlay-opacity', opacity);
                    } else {
                        clearTimeout(data.timeoutId);
                        pulsingNodes.delete(nodeId);
                    }
                });
            });

            if (pulsingNodes.size === 0 && pulseInterval) {
                clearInterval(pulseInterval);
                pulseInterval = null;
            }
        }, PULSE_INTERVAL_MS);
    }
}

export function removePulsingNode(cy, node) {
    const id = node.id();
    const existing = pulsingNodes.get(id);
    if (existing) {
        clearTimeout(existing.timeoutId);
        pulsingNodes.delete(id);
        node.style('overlay-opacity', null);
        node.style('overlay-color', null);

        if (pulsingNodes.size === 0 && pulseInterval) {
            clearInterval(pulseInterval);
            pulseInterval = null;
        }
    }
}

export function forceRemovePulsingNode(cy, nodeId) {
    const existing = pulsingNodes.get(nodeId);
    if (existing) {
        clearTimeout(existing.timeoutId);
        pulsingNodes.delete(nodeId);
        const node = cy.getElementById(nodeId);
        if (node.length) {
            node.style('overlay-opacity', null);
            node.style('overlay-color', null);
        }
        if (pulsingNodes.size === 0 && pulseInterval) {
            clearInterval(pulseInterval);
            pulseInterval = null;
        }
    }
}

export function stopAllPulsing() {
    if (pulseInterval) {
        clearInterval(pulseInterval);
        pulseInterval = null;
    }
    pulsingNodes.forEach((data, id) => {
        clearTimeout(data.timeoutId);
        const n = window.cy?.getElementById(id);
        if (n && n.length) {
            n.style('overlay-opacity', null);
            n.style('overlay-color', null);
        }
    });
    pulsingNodes.clear();
}

window.stopAllPulsing = stopAllPulsing;
window.forceRemovePulsingNode = forceRemovePulsingNode;
window.addPulsingNode = addPulsingNode;
window.removePulsingNode = removePulsingNode;