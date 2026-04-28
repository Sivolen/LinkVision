// pulse.js – пульсация для down (красная) и partial (жёлтая) с таймаутом 30 секунд
let pulsingNodes = new Map(); // id -> { type, timeoutId }
let pulseInterval = null;
let pulsePhase = 0;
const pulseStep = 0.025;
const minOpacity = 0.15;
const maxOpacity = 0.45;
const PULSE_DURATION = 30000; // 30 секунд

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
        // Убираем оверлей, но оставляем рамку
        node.style('overlay-opacity', null);
    }

    // Устанавливаем цвет оверлея в зависимости от типа
    const overlayColor = (type === 'down') ? '#dc3545' : '#ffc107';
    node.style('overlay-color', overlayColor);
    node.style('overlay-opacity', minOpacity);

    // Добавляем в пульсирующий набор
    pulsingNodes.set(id, {
        type: type,
        timeoutId: setTimeout(() => {
            // Через 30 секунд останавливаем пульсацию для этого узла
            const nodeData = pulsingNodes.get(id);
            if (nodeData) {
                pulsingNodes.delete(id);
                const n = cy.getElementById(id);
                if (n.length) {
                    n.style('overlay-opacity', null);
                    n.style('overlay-color', null);
                }
                // Если больше нет пульсирующих узлов, останавливаем интервал
                if (pulsingNodes.size === 0 && pulseInterval) {
                    clearInterval(pulseInterval);
                    pulseInterval = null;
                }
            }
        }, PULSE_DURATION)
    });

    // Запускаем глобальный интервал, если его ещё нет
    if (!pulseInterval && pulsingNodes.size > 0) {
        pulsePhase = 0;
        pulseInterval = setInterval(() => {
            pulsePhase += pulseStep;
            if (pulsePhase > 1) pulsePhase -= 2;
            const opacity = minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));

            pulsingNodes.forEach((data, nodeId) => {
                const n = cy.getElementById(nodeId);
                if (n.length) {
                    n.style('overlay-opacity', opacity);
                } else {
                    // Узел удалён — чистим
                    clearTimeout(data.timeoutId);
                    pulsingNodes.delete(nodeId);
                }
            });

            if (pulsingNodes.size === 0 && pulseInterval) {
                clearInterval(pulseInterval);
                pulseInterval = null;
            }
        }, 50);
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