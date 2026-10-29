// core.js – создание экземпляра Cytoscape, стили, базовая настройка
import { isCyAlive } from './labelScale.js';
import { CY_STYLE } from './styles.js';
import { updateBulkEditButton } from './bulk.js';
import { cleanupAll } from './moduleRegistry.js';

let cy = null;
let bulkBtnUpdateScheduled = false;
let themeObserver = null;
let themeRaf = 0;

// Тема переключается атрибутом data-theme на <html>. Стили Cytoscape с
// функциональными значениями (styles.js) пересчитываются через style().update();
// сам граф при этом не пересоздаётся. HTML-подписи устройств перекрашиваются
// чистым CSS и в этом не участвуют.
function watchTheme(instance) {
    if (themeObserver) themeObserver.disconnect();
    themeObserver = new MutationObserver(records => {
        if (!records.some(record => record.attributeName === 'data-theme')) return;
        if (cy !== instance || !isCyAlive(instance)) return;
        // Перекрашиваем только то, что рисует холст в цветах темы (рёбра, группы,
        // фигуры). Узлы-устройства с HTML-подписью от темы не зависят — их не
        // трогаем (полный style().update() на большой карте занимал сотни мс).
        // Один раз за кадр, даже если атрибут менялся несколько раз подряд.
        if (themeRaf) return;
        themeRaf = requestAnimationFrame(() => {
            themeRaf = 0;
            if (cy !== instance || !isCyAlive(instance)) return;
            instance.elements().not('.lv-html-label').updateStyle();
        });
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
        if (themeRaf) {
            cancelAnimationFrame(themeRaf);
            themeRaf = 0;
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
        fit: false,
        // Во время pan/zoom холст рисуется из готовой текстуры, а не заново из
        // сотен узлов/рёбер с подписями: на больших картах это главное, что
        // держит FPS. Подписи при этом не пропадают; после остановки жеста
        // Cytoscape перерисовывает граф начисто. (HTML-карточки устройств
        // лежат поверх и от этой опции не зависят.)
        textureOnViewport: true
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
