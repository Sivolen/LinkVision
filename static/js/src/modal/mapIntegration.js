/**
 * Map Integration Module
 * Интеграция с картой для модальных окон
 */

/**
 * Сохранить текущий viewport
 * @returns {Object|null}
 */
export function saveViewport() {
    if (!window.cy) return null;
    return {
        pan: window.cy.pan(),
        zoom: window.cy.zoom()
    };
}

/**
 * Восстановить viewport
 * @param {Object} viewport
 */
export function restoreViewport(viewport) {
    if (!viewport || !window.cy) return;
    
    window.cy.viewport({
        pan: viewport.pan,
        zoom: viewport.zoom
    });
    window.cy.style().update();
    
    if (typeof window.updateBackgroundTransform === 'function') {
        window.updateBackgroundTransform();
    }
    if (typeof window.enforcePanBounds === 'function') {
        window.enforcePanBounds();
    }
}

/**
 * The map bundle owns Cytoscape and its viewport state. Call its public
 * handler so the modal bundle never creates a second copy of that state.
 */
export async function reloadMapWithViewportRestore() {
    if (typeof window.reloadMapElements !== 'function') return;
    const reload = () => window.reloadMapElements();
    if (typeof window.withViewportRestore === 'function') {
        await window.withViewportRestore(reload);
    } else {
        await reload();
    }
}

/**
 * Инициализация модуля
 */
export function initMapIntegration() {
    window.saveViewport = saveViewport;
    window.restoreViewport = restoreViewport;
    Logger.info('Map integration инициализирован');
}
