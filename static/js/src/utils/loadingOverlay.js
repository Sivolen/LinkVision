import { t } from '../i18n/i18n.js';
// loadingOverlay.js – индикатор загрузки элементов карты
let overlay = null;

export function showMapLoading() {
    if (overlay) return; // Уже показан

    overlay = document.createElement('div');
    overlay.id = 'mapLoadingOverlay';
    overlay.className = 'map-loading-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
        <div class="map-loading-content">
            <div class="map-loading-spinner"></div>
            <span class="map-loading-text">${t('loading.mapLoading')}</span>
        </div>
    `;
    document.getElementById('cy')?.parentElement?.appendChild(overlay);
}

export function hideMapLoading() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
}
