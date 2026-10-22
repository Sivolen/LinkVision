// viewport.js – сохранение/восстановление панорамирования и зума
import { getCy } from './core.js';
import { updateBackgroundTransform, enforcePanBounds, isElementsLoaded } from './background.js';
import { http } from '../utils/http.js';
import { registerCleanup } from './moduleRegistry.js';

let viewportTimeout = null;

export function initViewport(cy) {
    cy.on('pan zoom', () => {
        updateBackgroundTransform();
        enforcePanBounds();
        saveViewportToServer();
    });
}

export function saveViewportToServer() {
    const cy = getCy();
    const mapId = window.currentMapId;
    if (!cy || !mapId) return;
    const pan = cy.pan();
    const zoom = cy.zoom();
    clearTimeout(viewportTimeout);
    viewportTimeout = setTimeout(() => {
        viewportTimeout = null;
        if (String(window.currentMapId) !== String(mapId)) return;
        http.put(`/api/map/${mapId}/viewport`, { pan_x: pan.x, pan_y: pan.y, zoom })
        .catch(err => console.debug('Viewport save failed:', err.message));
    }, 500);
}

export function cleanup() {
    if (viewportTimeout) {
        clearTimeout(viewportTimeout);
        viewportTimeout = null;
    }
}

registerCleanup(cleanup);

export function withViewportRestore(callback, skipAutoFit = true) {
    const cy = getCy();
    let savedViewport = null;
    if (cy) {
        savedViewport = { pan: cy.pan(), zoom: cy.zoom() };
    }
    if (skipAutoFit && typeof window.setSkipAutoFit === 'function') {
        window.setSkipAutoFit(true);
    }

    callback(); // reloadMapElements

    if (savedViewport && cy) {
        const restore = () => {
            cy.viewport({ pan: savedViewport.pan, zoom: savedViewport.zoom });
            cy.resize();         // принудительно пересчитать размеры
            cy.style().update();
            updateBackgroundTransform();
            enforcePanBounds();
            // Сбрасываем флаг ТОЛЬКО после восстановления
            if (skipAutoFit && typeof window.setSkipAutoFit === 'function') {
                window.setSkipAutoFit(false);
            }
        };

        // Используем requestAnimationFrame для синхронизации с отрисовкой
        const applyAfterRender = () => {
            requestAnimationFrame(() => {
                requestAnimationFrame(restore); // двойной RAF для надёжности
            });
        };

        // Ждём событие загрузки элементов или таймаут
        // Важно: слушатель и fallback-таймаут не должны срабатывать
        // дважды — второй вызов restore() мог бы откатить ручное
        // перемещение карты, сделанное пользователем между событиями.
        if (isElementsLoaded()) {
            applyAfterRender();
        } else {
            let settled = false;
            const runOnce = () => {
                if (settled) return;
                settled = true;
                clearTimeout(fallbackTimer);
                window.removeEventListener('elements:loaded', runOnce);
                applyAfterRender();
            };
            window.addEventListener('elements:loaded', runOnce);
            const fallbackTimer = setTimeout(runOnce, 1500);
        }
    } else {
        if (skipAutoFit && typeof window.setSkipAutoFit === 'function') {
            setTimeout(() => window.setSkipAutoFit(false), 2000);
        }
    }
}
