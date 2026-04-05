// modes.js – режимы pan / select / link mode
let cy = null;
let linkModeActive = false;
let sourceNode = null;

export function initModes(instance) { cy = instance; }

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

export function startLinkMode(clickedNode = null) {
    if (window.isOperator) {
        alert('Оператор не может создавать связи');
        return;
    }
    resetLinkMode();
    linkModeActive = true;
    if (clickedNode) {
        sourceNode = clickedNode;
        sourceNode.style('border-color', '#007bff');
        sourceNode.style('border-width', 5);
        const info = createInfoDiv('✅ Источник: ' + sourceNode.data('name') + '\n Выберите второе устройство');
        document.body.appendChild(info);
    } else {
        document.body.style.cursor = 'crosshair';
        const info = createInfoDiv('Выберите ПЕРВОЕ устройство');
        document.body.appendChild(info);
    }
}

export function resetLinkMode() {
    linkModeActive = false;
    if (sourceNode && cy) {
        sourceNode.style('border-color', null);
        sourceNode.style('border-width', null);
        sourceNode.selected(false);
        sourceNode.removeClass('cy-node-highlight');
    }
    sourceNode = null;
    document.body.style.cursor = 'default';
    const info = document.getElementById('linkInfo');
    if (info) info.remove();
    if (cy) {
        cy.elements().deselect();
        cy.nodes().forEach(node => {
            node.style('border-color', null);
            node.style('border-width', null);
        });
        cy.style().update();
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