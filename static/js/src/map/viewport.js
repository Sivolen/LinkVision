// viewport.js – сохранение/восстановление панорамирования и зума
import { getCy } from './core.js';
import { updateBackgroundTransform, enforcePanBounds } from './background.js';

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
    if (!cy) return;
    const pan = cy.pan();
    const zoom = cy.zoom();
    clearTimeout(viewportTimeout);
    viewportTimeout = setTimeout(() => {
        fetch(`/api/map/${window.currentMapId}/viewport`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ pan_x: pan.x, pan_y: pan.y, zoom })
        }).catch(err => console.debug('Viewport save failed:', err.message));
    }, 500);
}

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
        if (window.elementsLoaded === true) {
            applyAfterRender();
        } else {
            window.addEventListener('elements:loaded', applyAfterRender, { once: true });
            setTimeout(applyAfterRender, 1500);
        }
    } else {
        if (skipAutoFit && typeof window.setSkipAutoFit === 'function') {
            setTimeout(() => window.setSkipAutoFit(false), 2000);
        }
    }
}