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
 * Переиспользует каноническую событийную реализацию из map/viewport.js.
 * Раньше здесь была собственная "грубая" версия с setTimeout-гаданием,
 * которая дублировала window.withViewportRestore и конфликтовала с
 * правильной реализацией — какая из них реально работала, зависело от
 * порядка загрузки бандлов. Модалки всегда импортировали именно эту
 * версию напрямую, игнорируя глобальную переменную.
 */
import { withViewportRestore as canonicalWithViewportRestore } from '../map/viewport.js';
export const withViewportRestore = canonicalWithViewportRestore;

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
    Logger.info('Map integration инициализирован');
}
