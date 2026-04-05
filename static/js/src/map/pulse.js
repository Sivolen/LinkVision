// pulse.js – пульсация красной рамки у недоступных устройств
let pulsingNodes = new Set();
let pulseInterval = null;
let pulsePhase = 0;
const pulseStep = 0.015;
const minOpacity = 0.15;
const maxOpacity = 0.4;

export function initPulse(cy) {
    // ничего не делаем, просто сохраняем cy для глобальных вызовов
}

export function addPulsingNode(cy, node) {
    const id = node.id();
    if (!pulsingNodes.has(id)) {
        pulsingNodes.add(id);
        if (!pulseInterval) {
            pulsePhase = 0;
            pulseInterval = setInterval(() => {
                pulsePhase += pulseStep;
                if (pulsePhase > 1) pulsePhase -= 2;
                const opacity = minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));
                pulsingNodes.forEach(nid => {
                    const n = cy.getElementById(nid);
                    if (n.length) n.style('overlay-opacity', opacity);
                });
            }, 50);
        }
    }
}

export function removePulsingNode(cy, node) {
    const id = node.id();
    if (pulsingNodes.has(id)) {
        pulsingNodes.delete(id);
        node.style('overlay-opacity', null);
        if (pulsingNodes.size === 0 && pulseInterval) {
            clearInterval(pulseInterval);
            pulseInterval = null;
        }
    }
}