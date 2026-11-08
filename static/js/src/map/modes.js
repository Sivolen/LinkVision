import { t } from '../i18n/i18n.js';
import { registerCleanup } from './moduleRegistry.js';
import { markUserInteracted } from './background.js';
// modes.js – режимы pan / select / link mode
let cy = null;
let linkModeActive = false;
let sourceNode = null;
let wheelZoomHandler = null;
let wheelGestureTimer = null;

export function isWheelZoomActive() {
    return wheelGestureTimer !== null;
}

function cleanupWheelZoom() {
    if (wheelZoomHandler) document.removeEventListener('wheel', wheelZoomHandler, true);
    if (wheelGestureTimer !== null) clearTimeout(wheelGestureTimer);
    wheelZoomHandler = null;
    wheelGestureTimer = null;
    cy = null;
}

registerCleanup(cleanupWheelZoom);

export function withTemporaryPanning(instance, callback) {
    const wasPanningEnabled = instance.panningEnabled();
    if (!wasPanningEnabled) instance.panningEnabled(true);
    try {
        return callback();
    } finally {
        if (!wasPanningEnabled) instance.panningEnabled(false);
    }
}

export function initModes(instance) {
    cleanupWheelZoom();
    cy = instance;
    wheelZoomHandler = event => {
        const activeCy = cy;
        const container = activeCy?.container();
        if (
            !activeCy
            || !['pan', 'select'].includes(window.currentMode)
            || !activeCy.zoomingEnabled()
            || !activeCy.userZoomingEnabled()
            || event.buttons
            || !container?.contains(event.target)
        ) return;

        const rect = container.getBoundingClientRect();
        let delta = event.deltaY;
        if (event.deltaMode === 1) delta *= 33;
        else if (event.deltaMode === 2) delta *= Math.max(rect.height, 100);
        if (!Number.isFinite(delta) || delta === 0) return;

        // Use one predictable response in both modes. Cytoscape's wheel
        // calibration can misclassify Firefox's first events and multiply the
        // zoom by 2.56 per notch. Stop propagation so it cannot also handle it.
        event.preventDefault();
        event.stopPropagation();
        markUserInteracted();
        if (wheelGestureTimer !== null) clearTimeout(wheelGestureTimer);
        wheelGestureTimer = setTimeout(() => { wheelGestureTimer = null; }, 150);
        const level = activeCy.zoom() * Math.pow(10, -delta * 0.00012);
        withTemporaryPanning(activeCy, () => {
            activeCy.zoom({
                level,
                renderedPosition: {
                    x: event.clientX - rect.left,
                    y: event.clientY - rect.top
                }
            });
        });
    };
    document.addEventListener('wheel', wheelZoomHandler, { capture: true, passive: false });
    setMode('pan');
}

export function isLinkMode() { return linkModeActive; }
export function getSourceNode() { return sourceNode; }

export function setMode(mode) {
    if (!cy) return;
    const panBtn = document.getElementById('panMode');
    const selectBtn = document.getElementById('selectMode');
    if (panBtn) panBtn.classList.toggle('active', mode === 'pan');
    if (selectBtn) selectBtn.classList.toggle('active', mode === 'select');

    if (mode === 'select') {
        cy.boxSelectionEnabled(true);
        cy.autounselectify(false);
        // Wheel zoom is handled separately because Cytoscape disables its
        // built-in wheel handler whenever panning is disabled.
        cy.panningEnabled(false);
        cy.userPanningEnabled(false);
        document.body.style.cursor = 'crosshair';
    } else {
        cy.boxSelectionEnabled(false);
        cy.autounselectify(true);
        cy.panningEnabled(true);
        cy.userPanningEnabled(true);
        document.body.style.cursor = 'default';
    }
    cy.style().update();
    window.currentMode = mode; // для внешних проверок
    window.dispatchEvent(new CustomEvent('linkvision:mode-changed', { detail: { mode } }));
}

export function startLinkMode(clickedNode = null) {
    if (window.canEditMap !== true) {
        alert(t('common.accessDenied'));
        return;
    }
    resetLinkMode();
    linkModeActive = true;
    // The inspector is a read-only aid for pan mode. Leaving it over the
    // canvas while choosing endpoints obscures the second device and makes it
    // look as if a click in link mode opened a card.
    window.dispatchEvent(new CustomEvent('linkvision:link-mode-changed', { detail: { active: true } }));
    if (clickedNode) {
        sourceNode = clickedNode;
        sourceNode.addClass('cy-link-source');
        const info = createInfoDiv(t('modes.sourceSelectSecond', { name: sourceNode.data('name') }));
        document.body.appendChild(info);
    } else {
        document.body.style.cursor = 'crosshair';
        const info = createInfoDiv(t('modes.selectFirst'));
        document.body.appendChild(info);
    }
}

export function resetLinkMode() {
    linkModeActive = false;
    window.dispatchEvent(new CustomEvent('linkvision:link-mode-changed', { detail: { active: false } }));
    if (sourceNode && cy) {
        sourceNode.removeClass('cy-link-source');
        sourceNode.unselect();
    }
    sourceNode = null;
    document.body.style.cursor = 'default';
    const info = document.getElementById('linkInfo');
    if (info) info.remove();

    // Возвращаем индикатор в режим просмотра
    const currentMode = window.currentMode || 'pan';
    if (cy) {
        cy.elements().deselect();
        cy.nodes().forEach(node => {
            node.style('border-color', null);
            node.style('border-width', null);
        });
    }
}

function createInfoDiv(text) {
    const div = document.createElement('div');
    div.id = 'linkInfo';
    div.className = 'alert alert-info position-fixed';
    div.style.cssText = 'top:80px;left:50%;transform:translateX(-50%);z-index:1000;';
    div.textContent = text;
    return div;
}

// Глобальные вызовы
window.setMode = setMode;
window.startLinkMode = startLinkMode;
window.resetLinkMode = resetLinkMode;
