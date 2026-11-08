// pulse.js – пульсация для down (красная) и partial (жёлтая) с таймаутом 30 секунд
import { isWheelZoomActive } from './modes.js';
let pulsingNodes = new Map(); // id -> { type, timeoutId }
let pulseInterval = null;
let pulsePhase = 0;
const pulseStep = 0.025;
const minOpacity = 0.15;
const maxOpacity = 0.45;
const PULSE_DURATION = 30000; // 30 секунд
const PULSE_INTERVAL_MS = 100; // Увеличено с 50мс для производительности
const OVERVIEW_ZOOM_THRESHOLD = 0.5;

function isViewportBusy(cy) {
    try {
        const renderer = cy?.renderer?.();
        return isWheelZoomActive() || Boolean(renderer && (renderer.pinching || renderer.swipePanning ||
            (renderer.hoverData && renderer.hoverData.dragging) ||
            (renderer.data && renderer.data.wheelZooming))) || Boolean(cy?.animated?.());
    } catch (error) {
        return false;
    }
}

function downPulseColor() {
    // Same muted ruby as the overview aura: bright bootstrap-red is too
    // luminous against the graphite map surface in the dark theme.
    return document.documentElement?.dataset?.theme === 'dark' ? '#c85d6d' : '#dc3545';
}

function isOverviewZoom(node) {
    const zoom = node?.cy?.().zoom?.();
    return Number.isFinite(zoom) && zoom < OVERVIEW_ZOOM_THRESHOLD;
}

export function initPulse(cy) {}

export function addPulsingNode(cy, node, type = 'down') {
    // На общем плане status-аура из zoomEmphasis.js — устойчивый индикатор
    // проблемы. Короткая пульсация не должна каждую 100 мс перетирать её
    // opacity и визуально «сбрасывать» ореол сразу после F5.
    if (isOverviewZoom(node)) return;
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

    const overlayColor = (type === 'down') ? downPulseColor() : '#ffc107';
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
                    // На overview-zoom bypass-стили принадлежат постоянной
                    // ауре. Не снимать их по окончании короткой пульсации.
                    if (!isOverviewZoom(n)) {
                        n.style('overlay-opacity', null);
                        n.style('overlay-color', null);
                    }
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
            // При навигации каждый bypass-style вызывает лишний redraw canvas.
            // Пульсация продолжится с текущей фазы сразу после жеста.
            if (isViewportBusy(cy)) return;
            pulsePhase += pulseStep;
            if (pulsePhase > 1) pulsePhase -= 2;
            const opacity = minOpacity + (maxOpacity - minOpacity) * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI));

            cy.batch(() => {
                pulsingNodes.forEach((data, nodeId) => {
                    const n = cy.getElementById(nodeId);
                    if (n.length) {
                        // При отдалении не конкурируем с zoomEmphasis.
                        if (!isOverviewZoom(n) && n.visible()) n.style('overlay-opacity', opacity);
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
