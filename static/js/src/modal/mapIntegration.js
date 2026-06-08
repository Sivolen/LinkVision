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
 * Выполнить действие с восстановлением viewport
 * @param {Function} action
 */
export async function withViewportRestore(action) {
    const savedViewport = saveViewport();
    
    if (typeof window.setSkipAutoFit === 'function') {
        window.setSkipAutoFit(true);
    }
    
    try {
        if (typeof action === 'function') {
            await action();
        }
    } finally {
        if (savedViewport) {
            setTimeout(() => restoreViewport(savedViewport), 200);
            setTimeout(() => restoreViewport(savedViewport), 500);
        }
        
        setTimeout(() => {
            if (typeof window.setSkipAutoFit === 'function') {
                window.setSkipAutoFit(false);
            }
        }, 600);
    }
}

/**
 * Перезагрузить элементы карты с восстановлением viewport
 */
export async function reloadMapWithViewportRestore() {
    await withViewportRestore(() => {
        if (typeof window.reloadMapElements === 'function') {
            window.reloadMapElements();
        }
    });
}

/**
 * Инициализация модуля
 */
export function initMapIntegration() {
    window.saveViewport = saveViewport;
    window.restoreViewport = restoreViewport;
    window.withViewportRestore = withViewportRestore;
    Logger.info('✅ Map integration инициализирован');
}
