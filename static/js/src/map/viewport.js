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