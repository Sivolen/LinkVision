// core.js – создание экземпляра Cytoscape, стили, базовая настройка
import { CY_STYLE } from './styles.js';
import { updateBackgroundTransform, enforcePanBounds } from './background.js';
import { saveViewportToServer } from './viewport.js';

let cy = null;

export function getCy() {
    return cy;
}

export function initCy(mapId, onReady) {
    if (cy) {
        cy.destroy();
    }
    cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],
        style: CY_STYLE,
        layout: { name: 'preset' },
        boxSelectionEnabled: false,
        autounselectify: true,
        minZoom: 0.1,
        maxZoom: 5,
        wheelSensitivity: 0.5,
        fit: false
    });

    // События
    cy.on('pan zoom', () => {
        updateBackgroundTransform();
        enforcePanBounds();
        saveViewportToServer();
    });

    cy.on('select unselect', () => {
        import('./bulk.js').then(module => module.updateBulkEditButton());
    });

    if (typeof onReady === 'function') onReady(cy);
    return cy;
}

export function updateGroupLabelColor() {
    if (!cy) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#ffffff' : '#000000';
    cy.style()
        .selector('node[isGroup]')
        .style('color', textColor)
        .update();
}