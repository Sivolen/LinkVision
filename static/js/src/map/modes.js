import { t } from '../i18n/i18n.js';
// modes.js – режимы pan / select / link mode
let cy = null;
let linkModeActive = false;
let sourceNode = null;

const MODE_LABELS = {
    pan: 'modes.pan',
    select: 'modes.select',
    link: 'modes.link'
};

const MODE_CLASSES = {
    pan: 'mode-view',
    select: 'mode-edit',
    link: 'mode-link'
};

export function initModes(instance) { cy = instance; }

export function isLinkMode() { return linkModeActive; }
export function getSourceNode() { return sourceNode; }

export function setMode(mode) {
    if (!cy) return;
    const panBtn = document.getElementById('panMode');
    const selectBtn = document.getElementById('selectMode');
    if (panBtn) panBtn.classList.toggle('active', mode === 'pan');
    if (selectBtn) selectBtn.classList.toggle('active', mode === 'select');

    // Обновляем индикатор режима
    updateModeIndicator(mode);

    if (mode === 'select') {
        cy.boxSelectionEnabled(true);
        cy.autounselectify(false);
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
}

function updateModeIndicator(mode) {
    const indicator = document.getElementById('modeIndicator');
    if (!indicator) return;

    const label = MODE_LABELS[mode] ? t(MODE_LABELS[mode]) : mode;
    indicator.textContent = label;
    indicator.className = 'mode-badge ' + (MODE_CLASSES[mode] || '');
}

export function startLinkMode(clickedNode = null) {
    if (window.isOperator) {
        alert(t('modes.operatorNoLinks'));
        return;
    }
    resetLinkMode();
    linkModeActive = true;
    updateModeIndicator('link');

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
    if (sourceNode && cy) {
        sourceNode.removeClass('cy-link-source');
        sourceNode.selected(false);
    }
    sourceNode = null;
    document.body.style.cursor = 'default';
    const info = document.getElementById('linkInfo');
    if (info) info.remove();

    // Возвращаем индикатор в режим просмотра
    const currentMode = window.currentMode || 'pan';
    updateModeIndicator(currentMode);

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