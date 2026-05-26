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

    // Выполняем действие (обычно reloadMapElements)
    callback();

    if (savedViewport && cy) {
        const restore = () => {
            cy.viewport({ pan: savedViewport.pan, zoom: savedViewport.zoom });
            cy.style().update();
            if (typeof window.updateBackgroundTransform === 'function') {
                window.updateBackgroundTransform();
            }
            if (typeof window.enforcePanBounds === 'function') {
                window.enforcePanBounds();
            }
            // Сбрасываем skipAutoFit только после успешного восстановления
            if (skipAutoFit && typeof window.setSkipAutoFit === 'function') {
                window.setSkipAutoFit(false);
            }
        };
        setTimeout(restore, 200);
        setTimeout(restore, 500);
    } else {
        // Если нет сохранённого viewport (например, карта только создана), сбросим флаг через 2 секунды
        if (skipAutoFit && typeof window.setSkipAutoFit === 'function') {
            setTimeout(() => window.setSkipAutoFit(false), 2000);
        }
    }
}