// core.js – создание экземпляра Cytoscape, стили, базовая настройка
import { CY_STYLE } from './styles.js';
import { updateBulkEditButton } from './bulk.js';
import { cleanupAll } from './moduleRegistry.js';

let cy = null;
let bulkBtnUpdateScheduled = false;
let themeObserver = null;

// Тема переключается атрибутом data-theme на <html>. Стили Cytoscape с
// функциональными значениями (styles.js) пересчитываются через style().update();
// сам граф при этом не пересоздаётся. HTML-подписи устройств перекрашиваются
// чистым CSS и в этом не участвуют.
function watchTheme(instance) {
    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(records => {
        if (!records.some(record => record.attributeName === 'data-theme')) return;
        if (cy !== instance || instance.destroyed()) return;
        instance.style().update();
    });
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
    });
}

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
        cleanupAll();
        if (themeObserver) {
            themeObserver.disconnect();
            themeObserver = null;
        }
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

    watchTheme(cy);

    if (typeof onReady === 'function') onReady(cy);
    return cy;
}
