// core.js – создание экземпляра Cytoscape, стили, базовая настройка
import { CY_STYLE } from './styles.js';
import { updateBulkEditButton } from './bulk.js';
import { cleanup as cleanupLock } from './lock.js';
import { cleanup as cleanupEdgeLabels } from './edgeLabels.js';
import { cleanup as cleanupGroups } from './groupResize.js';

let cy = null;
let bulkBtnUpdateScheduled = false;

export function getCy() {
    return cy;
}

export function initCy(mapId, onReady) {
    if (cy) {
        // Останавливаем пульсацию перед уничтожением старого экземпляра
        if (typeof window.stopAllPulsing === 'function') {
            window.stopAllPulsing();
        }

        // Очищаем слушатели и таймеры перед уничтожением
        cleanupLock();
        cleanupEdgeLabels();
        cleanupGroups();

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
        wheelSensitivity: 1, // было 2 — резкий зум; Cytoscape рекомендует 1
        fit: false
    });

    // Нативное выделение рамкой шлёт событие select на КАЖДЫЙ узел.
    // Схлопываем пачку в один вызов через rAF — иначе 50+ узлов дают
    // 50 динамических import() + 50 полных сканов cy.nodes(':selected') = O(n²).
    cy.on('select unselect', () => {
        if (bulkBtnUpdateScheduled) return;
        bulkBtnUpdateScheduled = true;
        requestAnimationFrame(() => {
            bulkBtnUpdateScheduled = false;
            updateBulkEditButton();
        });
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